import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { StageInlineEdit, StageInlineField, StageInlinePane } from './stageTypes';

type StageInlineEditorProps = {
  edit: StageInlineEdit;
  onCommit: (value: string, pair?: { title: string; description: string }) => void;
  onCancel: () => void;
  onActivateField?: (field: StageInlineField) => void;
};

function paneStyle(edit: StageInlineEdit, pane: StageInlinePane, active: boolean): CSSProperties {
  return {
    left: pane.viewRect.x,
    top: pane.viewRect.y,
    width: Math.max(48, pane.viewRect.width),
    height: Math.max(22, pane.viewRect.height),
    background: pane.fill,
    color: pane.color,
    fontSize: `${pane.fontSize}px`,
    fontWeight: pane.fontWeight,
    ['--node-fill' as string]: edit.fill,
    ['--node-stroke' as string]: edit.stroke ?? '#d6ff3a',
    ['--node-text' as string]: edit.color,
    zIndex: active ? 9 : 8,
  };
}

export function StageInlineEditor({ edit, onCommit, onCancel, onActivateField }: StageInlineEditorProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const draftsRef = useRef({
    title: edit.field === 'title' ? edit.value : edit.companion?.value ?? '',
    description: edit.field === 'description' ? edit.value : edit.companion?.value ?? '',
    value: edit.value,
  });

  const hasNodePair = edit.kind === 'node' && Boolean(edit.companion);
  const nodePair = hasNodePair && edit.companion
    ? {
        title: edit.field === 'title' ? edit : edit.companion,
        description: edit.field === 'description' ? edit : edit.companion,
      }
    : null;

  useEffect(() => {
    const field = hasNodePair
      ? (edit.field === 'description' ? descRef.current : titleRef.current)
      : activeRef.current;
    if (!field) {
      return;
    }
    field.focus();
    if (edit.selectAll) {
      field.select();
    } else {
      const end = field.value.length;
      field.setSelectionRange(end, end);
    }
  }, [edit.field, edit.id, edit.kind, edit.selectAll, hasNodePair]);

  const commit = () => {
    if (nodePair) {
      const title = titleRef.current?.value ?? draftsRef.current.title;
      const description = descRef.current?.value ?? draftsRef.current.description;
      onCommit(edit.field === 'description' ? description : title, { title, description });
      return;
    }
    onCommit(activeRef.current?.value ?? draftsRef.current.value);
  };

  const blurMaybeCommit = () => {
    window.requestAnimationFrame(() => {
      if (shellRef.current?.contains(document.activeElement)) {
        return;
      }
      commit();
    });
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>,
    pane: 'title' | 'description' | 'single',
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === 'Tab' && nodePair) {
      event.preventDefault();
      event.stopPropagation();
      onActivateField?.(pane === 'description' ? 'title' : 'description');
      return;
    }
    if (event.key === 'Enter' && (pane !== 'description' || !event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      commit();
    }
  };

  const sharedPointer = {
    onPointerDown: (event: PointerEvent) => event.stopPropagation(),
    onDoubleClick: (event: MouseEvent) => event.stopPropagation(),
  };

  if (nodePair) {
    return (
      <div className="stage-inline-shell" ref={shellRef}>
        <textarea
          ref={titleRef}
          className={`stage-inline-edit is-title${edit.field === 'title' ? ' is-active' : ''}`}
          data-inline-field="title"
          defaultValue={nodePair.title.value}
          placeholder={nodePair.title.placeholder ?? '未命名内容'}
          spellCheck={false}
          rows={1}
          style={paneStyle(edit, nodePair.title, edit.field === 'title')}
          {...sharedPointer}
          onFocus={() => onActivateField?.('title')}
          onBlur={blurMaybeCommit}
          onChange={(event) => {
            draftsRef.current.title = event.target.value;
          }}
          onKeyDown={(event) => onKeyDown(event, 'title')}
        />
        <textarea
          ref={descRef}
          className={`stage-inline-edit is-description is-multiline${edit.field === 'description' ? ' is-active' : ''}`}
          data-inline-field="description"
          defaultValue={nodePair.description.value}
          placeholder={nodePair.description.placeholder ?? '（空）'}
          spellCheck={false}
          style={paneStyle(edit, nodePair.description, edit.field === 'description')}
          {...sharedPointer}
          onFocus={() => onActivateField?.('description')}
          onBlur={blurMaybeCommit}
          onChange={(event) => {
            draftsRef.current.description = event.target.value;
          }}
          onKeyDown={(event) => onKeyDown(event, 'description')}
        />
      </div>
    );
  }

  const style: CSSProperties = {
    left: edit.viewRect.x,
    top: edit.viewRect.y,
    width: Math.max(48, edit.viewRect.width),
    height: Math.max(22, edit.viewRect.height),
    background: edit.fill,
    color: edit.color,
    fontSize: `${edit.fontSize}px`,
    fontWeight: edit.fontWeight,
  };

  const shared = {
    className: `stage-inline-edit is-active${edit.multiline ? ' is-multiline' : ''}`,
    style,
    defaultValue: edit.value,
    spellCheck: false as const,
    'data-inline-field': edit.field,
    onPointerDown: sharedPointer.onPointerDown,
    onDoubleClick: sharedPointer.onDoubleClick,
    onBlur: commit,
    onChange: (event: { target: { value: string } }) => {
      draftsRef.current.value = event.target.value;
    },
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => onKeyDown(event, 'single'),
  };

  return (
    <div className="stage-inline-shell" ref={shellRef}>
      {edit.multiline ? (
        <textarea ref={(node) => { activeRef.current = node; }} {...shared} />
      ) : (
        <input ref={(node) => { activeRef.current = node; }} type="text" {...shared} />
      )}
    </div>
  );
}
