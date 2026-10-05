import type { FolderNode } from './projectFiles'

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500'

function NodeItem({ node, depth, activeKey, onSelect }: {
  node: FolderNode; depth: number; activeKey: string; onSelect: (n: FolderNode) => void
}) {
  const active = node.key === activeKey
  const icon = node.key === 'common' ? '🗂' : active ? '📂' : '📁'
  return (
    <li>
      <button type="button" onClick={() => onSelect(node)} aria-current={active ? 'page' : undefined}
        style={{ paddingLeft: `${0.75 + depth * 0.875}rem` }}
        className={`w-full min-h-[44px] flex items-center gap-2 pr-3 rounded-lg text-left text-sm transition-colors ${FOCUS} ${
          active ? 'bg-violet-50 text-violet-700 font-semibold' : 'text-gray-700 hover:bg-gray-100'}`}>
        <span aria-hidden="true">{icon}</span>
        <span className="truncate">{node.label}</span>
      </button>
      {node.children.length > 0 && (
        <ul>
          {node.children.map(c => <NodeItem key={c.key} node={c} depth={depth + 1} activeKey={activeKey} onSelect={onSelect} />)}
        </ul>
      )}
    </li>
  )
}

// Folder tree: Common first, then one node per task with its sub-folders.
// Stacks above the file panel on mobile and scrolls within itself.
export function FolderTree({ tree, activeKey, onSelect }: {
  tree: FolderNode[]; activeKey: string; onSelect: (n: FolderNode) => void
}) {
  return (
    <nav aria-label="Folders"
      className="md:w-64 md:flex-shrink-0 bg-white border border-gray-200 rounded-xl p-2 max-h-64 md:max-h-[70vh] overflow-y-auto">
      <p className="px-3 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Folders</p>
      <ul className="space-y-0.5">
        {tree.map(n => <NodeItem key={n.key} node={n} depth={0} activeKey={activeKey} onSelect={onSelect} />)}
      </ul>
    </nav>
  )
}
