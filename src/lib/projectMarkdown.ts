/** @deprecated Use `import { ... } from '../lmd'` or `./lmd`. */
export type { LmdInterpreterHooks } from '../lmd/projectMarkdown';
export {
  setLmdInterpreterHooks,
  buildProjectSuffixMarkdown,
  extractMermaidFromProjectMarkdown,
  parseProjectMarkdown,
  standardizeProjectMarkdown,
  serializeProjectMarkdown,
  createProjectMarkdownTemplate,
} from '../lmd/projectMarkdown';
