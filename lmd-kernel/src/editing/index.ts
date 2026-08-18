export { COMMAND_CATALOG, commandSpec } from './domain/catalog';
export type {
  CommandCategory,
  CommandContext,
  CommandOp,
  CommandResult,
  CommandSpec,
  LmdCommand,
} from './domain/command';
export { dispatchCommand } from './application/dispatch';
export { handleCommand } from './application/handlers';
