'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useCallback, useState } from 'react'
import { Bold, Italic, List } from 'lucide-react'

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detecta se a string é JSON do Tiptap (começa com `{"type":"doc"`) ou Markdown legado.
 */
export function isTiptapJson(value: string): boolean {
  try {
    const parsed = JSON.parse(value)
    return parsed?.type === 'doc'
  } catch {
    return false
  }
}

/**
 * Converte Markdown legado simples para JSON do Tiptap.
 */
export function markdownToTiptap(markdown: string): object {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const content: object[] = []
  let paragraph: object[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    content.push({ type: 'paragraph', content: paragraph })
    paragraph = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/)

    if (!line.trim()) {
      flushParagraph()
      continue
    }

    if (bulletMatch) {
      flushParagraph()
      const inlineNodes = parseInline(bulletMatch[1])
      content.push({
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: inlineNodes }] }],
      })
      continue
    }

    paragraph = [...paragraph, ...parseInline(line)]
    flushParagraph()
  }

  flushParagraph()
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] }
}

function parseInline(text: string): object[] {
  const nodes: object[] = []
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g
  let match
  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      nodes.push({ type: 'text', text: match[2], marks: [{ type: 'bold' }] })
    } else if (match[3]) {
      nodes.push({ type: 'text', text: match[3], marks: [{ type: 'italic' }] })
    } else if (match[4]) {
      nodes.push({ type: 'text', text: match[4] })
    }
  }
  return nodes.length > 0 ? nodes : [{ type: 'text', text }]
}

/**
 * Retorna o conteúdo normalizado como JSON do Tiptap.
 */
export function normalizeTiptapContent(value?: string | null): object {
  if (!value?.trim()) return { type: 'doc', content: [{ type: 'paragraph' }] }
  if (isTiptapJson(value)) return JSON.parse(value)
  return markdownToTiptap(value)
}

// ── Toolbar button ────────────────────────────────────────────────────────────

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-white/25 text-white'
          : 'text-white/75 hover:text-white hover:bg-white/15'
      }`}
    >
      {children}
    </button>
  )
}

// ── Fixed toolbar ────────────────────────────────────────────────────────────

interface FixedToolbarProps {
  editor: ReturnType<typeof useEditor>
  primaryColor: string
}

function FixedToolbar({ editor, primaryColor }: FixedToolbarProps) {
  if (!editor) return null

  return (
    <div
      className="mb-3 inline-flex items-center gap-0.5 rounded-xl px-1.5 py-1.5 shadow-sm border border-black/5"
      style={{ backgroundColor: primaryColor, zIndex: 1 }}
    >
      <ToolbarButton
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Negrito"
      >
        <Bold className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Itálico"
      >
        <Italic className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Lista"
      >
        <List className="w-3.5 h-3.5" />
      </ToolbarButton>
    </div>
  )
}

// ── TiptapEditor ─────────────────────────────────────────────────────────────

interface TiptapEditorProps {
  value?: string | null
  onChange?: (jsonString: string) => void
  onBlur?: (jsonString: string) => void
  placeholder?: string
  className?: string
  style?: React.CSSProperties
  editable?: boolean
  /** Quando true, o editor só ativa ao clicar */
  clickToEdit?: boolean
  primaryColor?: string
}

export function TiptapEditor({
  value,
  onChange,
  onBlur,
  placeholder = 'Clique para editar...',
  className = '',
  style,
  editable = true,
  clickToEdit = false,
  primaryColor = '#6366f1',
}: TiptapEditorProps) {
  const [isActive, setIsActive] = useState(!clickToEdit)
  const [hasFocus, setHasFocus] = useState(false)
  const initialContent = normalizeTiptapContent(value)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        code: false,
      }),
      Placeholder.configure({ placeholder, showOnlyWhenEditable: false }),
    ],
    content: initialContent,
    editable: editable && isActive,
    onUpdate: ({ editor }) => {
      onChange?.(JSON.stringify(editor.getJSON()))
    },
    onBlur: ({ editor }) => {
      setHasFocus(false)
      onBlur?.(JSON.stringify(editor.getJSON()))
    },
    onFocus: () => {
      setHasFocus(true)
    },
    editorProps: {
      attributes: {
        class: 'outline-none focus:outline-none min-h-[60px]',
      },
    },
    immediatelyRender: false,
  })

  // Atualiza conteúdo quando `value` muda externamente
  useEffect(() => {
    if (!editor) return
    const normalized = normalizeTiptapContent(value)
    const current = JSON.stringify(editor.getJSON())
    if (JSON.stringify(normalized) !== current) {
      editor.commands.setContent(normalized as Parameters<typeof editor.commands.setContent>[0], { emitUpdate: false })
    }
  }, [value, editor])

  // Sincroniza editable conforme isActive
  useEffect(() => {
    if (!editor) return
    editor.setEditable(editable && isActive)
    if (editable && isActive) {
      setTimeout(() => editor.commands.focus('end'), 0)
    }
  }, [editor, editable, isActive])

  const handleContainerClick = useCallback(() => {
    if (clickToEdit && !isActive) {
      setIsActive(true)
    }
  }, [clickToEdit, isActive])

  if (!editor) return null

  return (
    <div
      className={`tiptap-wrapper relative ${clickToEdit && !isActive ? 'cursor-text group' : ''} ${className}`}
      style={style}
      onClick={handleContainerClick}
    >
      {/* Hint "clique para editar" */}
      {clickToEdit && !isActive && (
        <span className="absolute -top-1 -right-1 text-[10px] bg-blue-500 text-white px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
          editar
        </span>
      )}

      {/* Toolbar fixa e confiável enquanto o editor está em foco */}
      {editable && isActive && hasFocus && (
        <FixedToolbar editor={editor} primaryColor={primaryColor} />
      )}

      <EditorContent
        editor={editor}
        className="tiptap-content prose-sm max-w-none [&_.ProseMirror]:min-h-[60px] [&_.ProseMirror>p]:mb-3 [&_.ProseMirror>p:last-child]:mb-0 [&_.ProseMirror>ul]:mb-3 [&_.ProseMirror>ul:last-child]:mb-0 [&_.ProseMirror>ul]:list-disc [&_.ProseMirror>ul]:pl-5 [&_.ProseMirror_strong]:font-semibold [&_.ProseMirror_em]:italic [&_.ProseMirror_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_.is-editor-empty:first-child::before]:text-current [&_.ProseMirror_.is-editor-empty:first-child::before]:opacity-40 [&_.ProseMirror_.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_.is-editor-empty:first-child::before]:h-0"
      />
    </div>
  )
}

// ── Render-only (server-safe) ─────────────────────────────────────────────────

import { generateHTML } from '@tiptap/core'
import StarterKitPkg from '@tiptap/starter-kit'

/**
 * Renderiza contentBody como HTML seguro.
 * JSON do Tiptap → generateHTML
 * Markdown legado → renderMarkdownFallback
 */
export function renderTiptapHtml(
  contentBody: string | null | undefined,
  renderMarkdownFallback: (text: string) => string,
): string {
  if (!contentBody?.trim()) return ''
  if (isTiptapJson(contentBody)) {
    try {
      const json = JSON.parse(contentBody)
      return generateHTML(json, [
        StarterKitPkg.configure({
          heading: false,
          blockquote: false,
          codeBlock: false,
          code: false,
        }),
      ])
    } catch {
      return renderMarkdownFallback(contentBody)
    }
  }
  return renderMarkdownFallback(contentBody)
}
