import { toSidecar, type GraphDocument } from '../..';
import { cloneWorkingDocument } from '../../application/editing/clone';
import { refreshSource } from '../../application/editing/source';

export { cloneWorkingDocument };

/** Print LMD source and refresh sidecar layout after a canvas commit. */
export function refreshWorkingDocument(doc: GraphDocument): GraphDocument {
  const next = refreshSource(doc);
  return {
    ...next,
    layout: toSidecar(next),
  };
}
