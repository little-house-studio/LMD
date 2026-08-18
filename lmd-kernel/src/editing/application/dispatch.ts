import { diagnosticMessage, LMD_DIAGNOSTIC_META } from '../../shared-kernel/codes';
import type { LmdDocument } from '../../document/domain/document';
import type { CommandContext, CommandResult, LmdCommand } from '../domain/command';
import { COMMAND_CATALOG } from '../domain/catalog';
import { handleCommand } from './handlers';

export function dispatchCommand(
  document: LmdDocument,
  command: LmdCommand,
  context: CommandContext = {},
): CommandResult {
  const known = COMMAND_CATALOG.some((item) => item.op === command.op);
  if (!known) {
    return {
      document,
      diagnostics: [
        {
          code: 'LMD900',
          severity: LMD_DIAGNOSTIC_META.LMD900.severity,
          message: diagnosticMessage('LMD900', command.op),
        },
      ],
    };
  }
  return handleCommand(document, command, context);
}
