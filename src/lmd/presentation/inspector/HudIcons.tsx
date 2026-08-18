type IconName =
  | 'menu'
  | 'undo'
  | 'redo'
  | 'select'
  | 'hand'
  | 'node'
  | 'frame'
  | 'sequence'
  | 'mind'
  | 'connect'
  | 'tidy'
  | 'more'
  | 'search'
  | 'layers'
  | 'help'
  | 'minus'
  | 'plus'
  | 'map'
  | 'trash'
  | 'copy'
  | 'group'
  | 'ungroup'
  | 'edit'
  | 'child'
  | 'sibling'
  | 'mirror'
  | 'chevron';

const paths: Record<IconName, string> = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  undo: 'M9 8H5V4M5.2 8a8 8 0 1 1-1 4.5',
  redo: 'M15 8h4V4M18.8 8a8 8 0 1 0 1 4.5',
  select: 'M5 4l6 16 2.2-6.2L19.5 12 5 4z',
  hand: 'M8 13V8.2M11 12.5V7M14 12.5V8.5M17 13v2.2a4.2 4.2 0 0 1-8.4 0V13',
  node: 'M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 10h8M8 14h5',
  frame: 'M5 8V5h3M16 5h3v3M19 16v3h-3M8 19H5v-3',
  sequence: 'M6 4h4v4H6zM14 4h4v4h-4zM8 8v12M16 8v12M8 14h8',
  mind: 'M12 5v4M8 13h8M6 19h4M14 19h4M12 9c-2.2 0-4 1.8-4 4M12 9c2.2 0 4 1.8 4 4',
  connect: 'M8 8h.01M16 16h.01M10 8h6a2 2 0 0 1 2 2v2M14 16H8a2 2 0 0 1-2-2v-2',
  tidy: 'M5 7h14M5 12h10M5 17h6',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  search: 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM16 16l4 4',
  layers: 'M12 4 4 8l8 4 8-4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4',
  help: 'M12 17h.01M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.1 1-1.1 1.8V14',
  minus: 'M6 12h12',
  plus: 'M12 6v12M6 12h12',
  map: 'M4 6.5 9 4l6 3 5-2.5V17.5L15 20l-6-3-5 2.5V6.5zM9 4v13M15 7v13',
  trash: 'M5 7h14M10 7V5h4v2M8 7l.7 12h6.6L16 7',
  copy: 'M8 8h10v12H8zM6 16H4V4h12v2',
  group: 'M6 6h6v6H6zM12 12h6v6h-6z',
  ungroup: 'M5 5h6v6H5zM13 13h6v6h-6zM11 8h2M8 11v2',
  edit: 'M4 20h4l11-11-4-4L4 16v4zM13 7l4 4',
  child: 'M6 5h8v6H6zM10 11v4M7 19h6',
  sibling: 'M4 8h7v8H4zM13 8h7v8h-7z',
  mirror: 'M11 4v16M6 8H4v8h2M18 8h2v8h-2',
  chevron: 'M8 10l4 4 4-4',
};

export function HudIcon({ name, size = 13 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d={paths[name]} />
    </svg>
  );
}
