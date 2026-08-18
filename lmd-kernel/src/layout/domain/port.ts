import type { LmdDocument } from '../../document';

export interface LayoutBackend {
  id: string;
  auto: (document: LmdDocument) => LmdDocument;
  tidy: (document: LmdDocument) => LmdDocument;
}
