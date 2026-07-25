import { useState, type ReactNode } from 'react';
import { useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { Icon, type IconName } from '../components/Icons';
import { LinkDialog } from './LinkDialog';

/**
 * Formatting toolbar.
 *
 * Two details matter for usability:
 *
 * - `onMouseDown` is prevented on every control, so pressing a button never
 *   moves focus out of the document and the user's selection survives.
 * - Active and disabled state come from a single `useEditorState` selector, so
 *   the toolbar re-renders once per relevant transaction instead of on every
 *   keystroke of the editor tree.
 */
export function EditorToolbar({ editor }: { editor: Editor }) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      isBold: instance.isActive('bold'),
      isItalic: instance.isActive('italic'),
      isUnderline: instance.isActive('underline'),
      isStrike: instance.isActive('strike'),
      isCode: instance.isActive('code'),
      isParagraph: instance.isActive('paragraph'),
      isHeading1: instance.isActive('heading', { level: 1 }),
      isHeading2: instance.isActive('heading', { level: 2 }),
      isHeading3: instance.isActive('heading', { level: 3 }),
      isBulletList: instance.isActive('bulletList'),
      isOrderedList: instance.isActive('orderedList'),
      isTaskList: instance.isActive('taskList'),
      isBlockquote: instance.isActive('blockquote'),
      isCodeBlock: instance.isActive('codeBlock'),
      isLink: instance.isActive('link'),
      linkHref: (instance.getAttributes('link').href as string | undefined) ?? '',

      canUndo: instance.can().undo(),
      canRedo: instance.can().redo(),
      canBold: instance.can().chain().toggleBold().run(),
      canItalic: instance.can().chain().toggleItalic().run(),
      canUnderline: instance.can().chain().toggleUnderline().run(),
      canStrike: instance.can().chain().toggleStrike().run(),
      canCode: instance.can().chain().toggleCode().run(),
      canHeading: instance.can().chain().toggleHeading({ level: 1 }).run(),
      canParagraph: instance.can().chain().setParagraph().run(),
      canBulletList: instance.can().chain().toggleBulletList().run(),
      canOrderedList: instance.can().chain().toggleOrderedList().run(),
      canTaskList: instance.can().chain().toggleTaskList().run(),
      canBlockquote: instance.can().chain().toggleBlockquote().run(),
      canCodeBlock: instance.can().chain().toggleCodeBlock().run(),
      canLink: instance.can().chain().setLink({ href: 'https://example.com' }).run(),
      canClear: instance.can().chain().unsetAllMarks().run(),
    }),
  });

  const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

  return (
    <div className="toolbar" role="group" aria-label="Formatting">
      <div className="toolbar__group">
        <ToolbarButton
          icon="undo"
          label="Undo"
          hint={`${mod}+Z`}
          disabled={!state.canUndo}
          onActivate={() => editor.chain().focus().undo().run()}
        />
        <ToolbarButton
          icon="redo"
          label="Redo"
          hint={`${mod}+Shift+Z`}
          disabled={!state.canRedo}
          onActivate={() => editor.chain().focus().redo().run()}
        />
      </div>

      <div className="toolbar__group">
        <ToolbarButton
          text="P"
          label="Paragraph"
          active={state.isParagraph}
          disabled={!state.canParagraph}
          onActivate={() => editor.chain().focus().setParagraph().run()}
        />
        <ToolbarButton
          text="H1"
          label="Heading 1"
          active={state.isHeading1}
          disabled={!state.canHeading}
          onActivate={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        />
        <ToolbarButton
          text="H2"
          label="Heading 2"
          active={state.isHeading2}
          disabled={!state.canHeading}
          onActivate={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarButton
          text="H3"
          label="Heading 3"
          active={state.isHeading3}
          disabled={!state.canHeading}
          onActivate={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        />
      </div>

      <div className="toolbar__group">
        <ToolbarButton
          text="B"
          textClass="glyph--bold"
          label="Bold"
          hint={`${mod}+B`}
          active={state.isBold}
          disabled={!state.canBold}
          onActivate={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          text="I"
          textClass="glyph--italic"
          label="Italic"
          hint={`${mod}+I`}
          active={state.isItalic}
          disabled={!state.canItalic}
          onActivate={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          text="U"
          textClass="glyph--underline"
          label="Underline"
          hint={`${mod}+U`}
          active={state.isUnderline}
          disabled={!state.canUnderline}
          onActivate={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolbarButton
          text="S"
          textClass="glyph--strike"
          label="Strikethrough"
          hint={`${mod}+Shift+S`}
          active={state.isStrike}
          disabled={!state.canStrike}
          onActivate={() => editor.chain().focus().toggleStrike().run()}
        />
        <ToolbarButton
          text="<>"
          textClass="glyph--code"
          label="Inline code"
          hint={`${mod}+E`}
          active={state.isCode}
          disabled={!state.canCode}
          onActivate={() => editor.chain().focus().toggleCode().run()}
        />
      </div>

      <div className="toolbar__group">
        <ToolbarButton
          icon="listBullet"
          label="Bulleted list"
          active={state.isBulletList}
          disabled={!state.canBulletList}
          onActivate={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          icon="listOrdered"
          label="Numbered list"
          active={state.isOrderedList}
          disabled={!state.canOrderedList}
          onActivate={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          icon="listCheck"
          label="Checklist"
          active={state.isTaskList}
          disabled={!state.canTaskList}
          onActivate={() => editor.chain().focus().toggleTaskList().run()}
        />
      </div>

      <div className="toolbar__group">
        <ToolbarButton
          icon="quote"
          label="Block quote"
          active={state.isBlockquote}
          disabled={!state.canBlockquote}
          onActivate={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton
          icon="codeBlock"
          label="Code block"
          active={state.isCodeBlock}
          disabled={!state.canCodeBlock}
          onActivate={() => editor.chain().focus().toggleCodeBlock().run()}
        />
      </div>

      <div className="toolbar__group">
        <ToolbarButton
          icon="link"
          label={state.isLink ? 'Edit link' : 'Add link'}
          active={state.isLink}
          disabled={!state.canLink && !state.isLink}
          onActivate={() => setLinkDialogOpen(true)}
        />
        <ToolbarButton
          icon="linkOff"
          label="Remove link"
          disabled={!state.isLink}
          onActivate={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
        />
        <ToolbarButton
          icon="clearFormat"
          label="Clear formatting"
          disabled={!state.canClear}
          onActivate={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        />
      </div>

      <LinkDialog
        open={linkDialogOpen}
        initialHref={state.linkHref}
        onClose={() => {
          setLinkDialogOpen(false);
          editor.commands.focus();
        }}
        onSubmit={(href) => {
          editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
        }}
        onRemove={() => {
          editor.chain().focus().extendMarkRange('link').unsetLink().run();
        }}
      />
    </div>
  );
}

function ToolbarButton({
  icon,
  text,
  textClass,
  label,
  hint,
  active,
  disabled,
  onActivate,
}: {
  icon?: IconName;
  text?: string;
  textClass?: string;
  label: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  onActivate: () => void;
}) {
  const title = hint ? `${label} (${hint})` : label;
  let content: ReactNode;
  if (icon) content = <Icon name={icon} />;
  else {
    content = (
      <span className={`glyph${textClass ? ` ${textClass}` : ''}`} aria-hidden="true">
        {text}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="toolbar__button"
      title={title}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      // Keep the document selection intact when the control is clicked.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onActivate}
    >
      {content}
    </button>
  );
}
