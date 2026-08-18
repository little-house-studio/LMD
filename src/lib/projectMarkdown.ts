/** @deprecated Use `import { ... } from '../lmd'` or `./lmd`. */
export type { LmdInterpreterHooks } from '../lmd/infrastructure/compat/projectMarkdown';
export {
  setLmdInterpreterHooks,
  buildProjectSuffixMarkdown,
  extractMermaidFromProjectMarkdown,
  parseProjectMarkdown,
  standardizeProjectMarkdown,
  serializeProjectMarkdown,
  createProjectMarkdownTemplate,
} from '../lmd/infrastructure/compat/projectMarkdown';
