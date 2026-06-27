package googleapi

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// maxDriveFiles caps one files.list call.
const (
	maxDriveFiles           = 10
	maxDriveWriteContentLen = 256 << 10
)

// DriveFile is the narrow read shape the runtime's Drive connector returns:
// metadata only, no file contents.
type DriveFile struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	MIMEType     string   `json:"mimeType"`
	ModifiedTime string   `json:"modifiedTime,omitempty"`
	WebViewLink  string   `json:"webViewLink,omitempty"`
	Owners       []string `json:"owners,omitempty"`
}

// DriveFileMutation is the metadata/content shape accepted by Drive write tools.
type DriveFileMutation struct {
	Name        string
	Description string
	MIMEType    string
	Content     string
}

// ListDriveFiles lists the connected user's Drive files using Google Drive q
// syntax. Empty query returns recent files by modified time.
func (c *Client) ListDriveFiles(ctx context.Context, token, query string, limit int) ([]DriveFile, error) {
	if limit <= 0 || limit > maxDriveFiles {
		limit = maxDriveFiles
	}
	q := url.Values{}
	q.Set("pageSize", strconv.Itoa(limit))
	q.Set("orderBy", "modifiedTime desc")
	q.Set("fields", "files(id,name,mimeType,modifiedTime,webViewLink,owners(emailAddress,displayName))")
	if query != "" {
		q.Set("q", query)
	}

	var list struct {
		Files []struct {
			ID           string `json:"id"`
			Name         string `json:"name"`
			MIMEType     string `json:"mimeType"`
			ModifiedTime string `json:"modifiedTime"`
			WebViewLink  string `json:"webViewLink"`
			Owners       []struct {
				EmailAddress string `json:"emailAddress"`
				DisplayName  string `json:"displayName"`
			} `json:"owners"`
		} `json:"files"`
	}
	if err := c.GetJSON(ctx, token, c.cfg.DriveBaseURL+"/files", q, &list); err != nil {
		return nil, fmt.Errorf("drive files.list: %w", err)
	}

	out := make([]DriveFile, 0, len(list.Files))
	for _, f := range list.Files {
		file := DriveFile{
			ID:           f.ID,
			Name:         f.Name,
			MIMEType:     f.MIMEType,
			ModifiedTime: f.ModifiedTime,
			WebViewLink:  f.WebViewLink,
		}
		for _, owner := range f.Owners {
			if owner.EmailAddress != "" {
				file.Owners = append(file.Owners, owner.EmailAddress)
			} else if owner.DisplayName != "" {
				file.Owners = append(file.Owners, owner.DisplayName)
			}
		}
		out = append(out, file)
	}
	return out, nil
}

// UpdateDriveFileMetadata updates writable metadata on one Drive file.
func (c *Client) UpdateDriveFileMetadata(ctx context.Context, token, fileID string, in DriveFileMutation) (DriveFile, error) {
	if fileID == "" {
		return DriveFile{}, fmt.Errorf("drive file id is required")
	}
	body := map[string]any{}
	if in.Name != "" {
		body["name"] = in.Name
	}
	if in.Description != "" {
		body["description"] = in.Description
	}
	if in.MIMEType != "" {
		body["mimeType"] = in.MIMEType
	}
	if len(body) == 0 {
		return DriveFile{}, fmt.Errorf("at least one drive metadata field is required")
	}
	var out driveAPIFile
	endpoint := c.cfg.DriveBaseURL + "/files/" + url.PathEscape(fileID) + "?fields=id,name,mimeType,modifiedTime,webViewLink,owners(emailAddress,displayName)"
	if err := c.PatchJSON(ctx, token, endpoint, body, &out); err != nil {
		return DriveFile{}, fmt.Errorf("drive files.update metadata: %w", err)
	}
	return out.toDriveFile(), nil
}

// ReplaceDriveFileTextContent replaces a Drive file's content with bounded text.
// It uses the upload endpoint and may also update name/mimeType metadata.
func (c *Client) ReplaceDriveFileTextContent(ctx context.Context, token, fileID string, in DriveFileMutation) (DriveFile, error) {
	if fileID == "" {
		return DriveFile{}, fmt.Errorf("drive file id is required")
	}
	if in.Content == "" {
		return DriveFile{}, fmt.Errorf("drive file content is required")
	}
	if len(in.Content) > maxDriveWriteContentLen {
		return DriveFile{}, fmt.Errorf("drive file content is %d bytes; the limit is %d", len(in.Content), maxDriveWriteContentLen)
	}
	mediaType := in.MIMEType
	if mediaType == "" {
		mediaType = "text/plain; charset=UTF-8"
	}
	metadata := map[string]any{}
	if in.Name != "" {
		metadata["name"] = in.Name
	}
	if in.MIMEType != "" {
		metadata["mimeType"] = in.MIMEType
	}
	body, contentType, err := multipartRelated(metadata, []byte(in.Content), mediaType)
	if err != nil {
		return DriveFile{}, err
	}
	q := url.Values{}
	q.Set("uploadType", "multipart")
	q.Set("fields", "id,name,mimeType,modifiedTime,webViewLink,owners(emailAddress,displayName)")
	endpoint := queryURL(driveUploadBaseURL(c.cfg.DriveBaseURL)+"/files/"+url.PathEscape(fileID), q)
	var out driveAPIFile
	if err := c.PatchRaw(ctx, token, endpoint, contentType, body, &out); err != nil {
		return DriveFile{}, fmt.Errorf("drive files.update content: %w", err)
	}
	return out.toDriveFile(), nil
}

type driveAPIFile struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	MIMEType     string `json:"mimeType"`
	ModifiedTime string `json:"modifiedTime"`
	WebViewLink  string `json:"webViewLink"`
	Owners       []struct {
		EmailAddress string `json:"emailAddress"`
		DisplayName  string `json:"displayName"`
	} `json:"owners"`
}

func (f driveAPIFile) toDriveFile() DriveFile {
	out := DriveFile{
		ID:           f.ID,
		Name:         f.Name,
		MIMEType:     f.MIMEType,
		ModifiedTime: f.ModifiedTime,
		WebViewLink:  f.WebViewLink,
	}
	for _, owner := range f.Owners {
		if owner.EmailAddress != "" {
			out.Owners = append(out.Owners, owner.EmailAddress)
		} else if owner.DisplayName != "" {
			out.Owners = append(out.Owners, owner.DisplayName)
		}
	}
	return out
}

func driveUploadBaseURL(base string) string {
	base = strings.TrimRight(base, "/")
	if strings.HasSuffix(base, "/drive/v3") {
		return strings.TrimSuffix(base, "/drive/v3") + "/upload/drive/v3"
	}
	return base + "/upload"
}
