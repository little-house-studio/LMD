import { fromLegacyDocument, registerLayoutBackend, toLegacyDocument } from '@lths/lmd';
import { autoLayoutDocument, tidyLayoutDocument } from '../../application/editing';

/** Register the editor solver as the kernel layout port. */
export function registerEditorLayoutBackend() {
  registerLayoutBackend({
    id: 'lmd-editor-solver',
    auto: (document) => fromLegacyDocument(autoLayoutDocument(toLegacyDocument(document))),
    tidy: (document) => fromLegacyDocument(tidyLayoutDocument(toLegacyDocument(document))),
  });
}
