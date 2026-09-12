import type { ItemStatus, ItemType, ContainerKind, ContainerStatus, ResourceCategory } from "@/db/enums";

export interface ContainerRefDTO {
  id: number;
  name: string;
  slug: string;
  kind: ContainerKind;
}

export interface PersonRefDTO {
  id: number;
  name: string;
  slug: string;
}

export interface ItemDTO {
  id: number;
  type: ItemType;
  title: string;
  body: string;
  status: ItemStatus;
  error: string | null;
  sourceUrl: string | null;
  filePath: string | null;
  mimeType: string | null;
  extractedText: string;
  meta: Record<string, unknown>;
  tags: string[];
  journalDate: string | null;
  reviewWeek: string | null;
  containerId: number | null;
  container: ContainerRefDTO | null;
  archivedAt: string | null;
  people: PersonRefDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface SearchResultDTO {
  item: ItemDTO;
  snippet: string;
  score: number;
  chunkId: number;
}

export interface ContainerDTO {
  id: number;
  kind: ContainerKind;
  name: string;
  slug: string;
  description: string;
  status: ContainerStatus;
  goal: string;
  deadline: string | null;
  standard: string;
  category: ResourceCategory | null;
  nextSteps: string;
  sortOrder: number;
  archivedAt: string | null;
  itemCount: number;
  totalItemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersonDTO {
  id: number;
  name: string;
  slug: string;
  profile: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}
