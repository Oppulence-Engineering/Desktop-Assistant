export interface LeadRecord {
  id: string;
  company: string;
  score: number;
  status: "Confirmed" | "Review";
  contact: string;
}

export const ROWS: readonly LeadRecord[] = [
  {
    id: "acme-1",
    company: "Acme Corp",
    score: 94,
    status: "Confirmed",
    contact: "Maya Chen",
  },
  {
    id: "acme-2",
    company: "Acme Corp",
    score: 88,
    status: "Confirmed",
    contact: "Jon Bell",
  },
  {
    id: "acme-3",
    company: "Acme Corp",
    score: 79,
    status: "Review",
    contact: "Priya Shah",
  },
  {
    id: "acme-4",
    company: "Acme Corp",
    score: 72,
    status: "Review",
    contact: "Noah Kim",
  },
];
