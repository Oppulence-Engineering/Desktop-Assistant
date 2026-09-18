import { SimDownloadPage } from "../sim-landing/subpages/sim-download-page";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Download Oppulence",
  description:
    "Install Oppulence Desktop or Oppulence Voice on macOS, Windows, or Linux. Signed builds from GitHub Releases, with auto-update.",
  path: "/download",
});

export default function DownloadPage() {
  return <SimDownloadPage />;
}
