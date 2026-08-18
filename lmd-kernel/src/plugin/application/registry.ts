import type { CommandOp, LmdCommand } from '../../editing';
import type { Diagnostic } from '../../diagnostics';
import type { LmdDocument } from '../../document';
import type { CapabilityName } from '../../runtime';

export type PluginContributionKind = 'command' | 'diagnostic' | 'inspector' | 'toolbar' | 'capability';

export interface PluginManifest {
  name: string;
  version: string;
  engineRange: string;
  contributions: PluginContributionKind[];
  commands?: CommandOp[];
  capabilities?: CapabilityName[];
  entry?: string;
}

export interface PluginModule {
  manifest: PluginManifest;
  onLoad?: () => void;
  onDocumentChange?: (document: LmdDocument) => Diagnostic[];
  handleCommand?: (document: LmdDocument, command: LmdCommand) => LmdDocument | null;
}

const registry = new Map<string, PluginModule>();

export function registerPlugin(module: PluginModule) {
  registry.set(module.manifest.name, module);
  module.onLoad?.();
}

export function unregisterPlugin(name: string) {
  registry.delete(name);
}

export function listPlugins() {
  return [...registry.values()].map((item) => item.manifest);
}

export function getPlugin(name: string) {
  return registry.get(name) ?? null;
}
