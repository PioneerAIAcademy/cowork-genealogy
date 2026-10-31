import { useEffect, useRef, useState } from 'react'

export default function TitleEditor({
  title,
  onSave,
  onCancel
}: {
  title: string
  onSave: (title: string) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  const finishedRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const save = (): void => {
    if (finishedRef.current) return
    finishedRef.current = true
    const next = value.trim()
    if (!next || next === title) onCancel()
    else void onSave(next)
  }

  return (
    <input
      ref={inputRef}
      className="titleEditor"
      aria-label="Session name"
      maxLength={120}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          save()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finishedRef.current = true
          onCancel()
        }
      }}
      onBlur={save}
    />
  )
}
