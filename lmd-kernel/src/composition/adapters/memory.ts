import type { LmdDocument } from '../../document';
import { dispatchCommand, type CommandResult, type LmdCommand } from '../../editing';

export interface AdapterInvokeInput {
  document: LmdDocument;
  command: LmdCommand;
}

export interface LmdAdapter {
  id: string;
  invoke: (input: AdapterInvokeInput) => CommandResult | Promise<CommandResult>;
}

export function createMemoryAdapter(id = 'memory'): LmdAdapter & { store: Map<string, LmdDocument> } {
  const store = new Map<string, LmdDocument>();
  return {
    id,
    store,
    invoke(input) {
      const result = dispatchCommand(input.document, input.command);
      store.set(input.document.project.name || id, result.document);
      return result;
    },
  };
}
