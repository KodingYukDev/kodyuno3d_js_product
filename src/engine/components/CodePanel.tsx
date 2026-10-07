import Editor from '@monaco-editor/react'
import { useKodyUnoStore } from '@kodyuno/store/useKodyUnoStore'
import { CodeIcon, CopyIcon } from '@kodyuno/components/icons/Icons'

export function CodePanel() {
  const code = useKodyUnoStore((s) => s.generatedCode)

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><CodeIcon size={14} /> Kode C++ (Arduino)</span>
        {code && (
          <button
            onClick={() => navigator.clipboard.writeText(code)}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-slate-100 border border-slate-300 text-slate-500 hover:bg-slate-200"
          >
            <CopyIcon size={11} /> Salin
          </button>
        )}
      </div>
      <div className="flex-1">
        <Editor
          height="100%"
          language="cpp"
          value={code || '// Drag blok ke workspace untuk membuat kode Arduino...'}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            padding: { top: 8 },
          }}
          theme="vs-dark"
        />
      </div>
    </div>
  )
}
