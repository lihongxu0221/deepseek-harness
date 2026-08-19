/**
 * Browser-owned project editor: display title, extra source folders, and
 * removal of the Workspace registration. Folder add/remove stay local until
 * Save; the primary directory is display-only.
 */
import {
  Button, IconCloseOutline16, IconFolderClose16, IconProjectAddOutline16, Input, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import css from './WorkspaceEditDialog.module.css'

/** The standard locale seat, prop-passed from the browser root. */
type EditTranslate = WorkspaceBrowserProps['t']

/** Last path segment for a host directory; the full path stays on the title. */
export function folderLabel(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/**
 * Render the Edit project dialog.
 * @param props.open - whether the dialog is showing.
 * @param props.title - current display-name draft.
 * @param props.path - immutable primary directory.
 * @param props.folders - extra directories in the draft (not including path).
 * @param props.busy - Save / directory pick in flight; inputs disable.
 * @param props.error - host or conflict message under the form.
 * @param props.duplicateName - another Workspace already uses the trimmed title.
 * @param props.flowAvailable - directory-flow hole occupied; hides Add folder otherwise.
 * @param props.onTitleChange - display-name draft changed.
 * @param props.onClose - Cancel, Escape, or the header close control.
 * @param props.onSave - commit title and folder diffs.
 * @param props.onRemoveProject - leave the editor and confirm registration deletion.
 * @param props.onAddFolder - open the directory flow for one extra folder.
 * @param props.onRemoveFolder - drop one extra folder from the draft.
 * @param props.t - workspace locale seat.
 * @returns the modal, or null while closed.
 */
export function WorkspaceEditDialog({
  open, title, path, folders, busy, error, duplicateName, flowAvailable,
  onTitleChange, onClose, onSave, onRemoveProject, onAddFolder, onRemoveFolder, t,
}: {
  open: boolean
  title: string
  path: string
  folders: readonly string[]
  busy: boolean
  error: string | null
  duplicateName: boolean
  flowAvailable: boolean
  onTitleChange: (title: string) => void
  onClose: () => void
  onSave: () => void
  onRemoveProject: () => void
  onAddFolder: () => void
  onRemoveFolder: (path: string) => void
  t: EditTranslate
}) {
  const trimmed = title.trim()
  const saveBlocked = busy || trimmed === '' || duplicateName
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t('close')}
      title={t('edit.project.title')}
      className={css.card}
      footer={(
        <div className={css.footer}>
          <Button
            variant="outline"
            className={css.removeProject}
            disabled={busy}
            onClick={onRemoveProject}
          >
            {t('edit.project.remove')}
          </Button>
          <span className={css.footerActions}>
            <Button variant="outline" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
            <Button variant="primary" disabled={saveBlocked} onClick={onSave}>{t('save')}</Button>
          </span>
        </div>
      )}
    >
      <Input
        icon={<IconFolderClose16 />}
        className={css.name}
        value={title}
        aria-label={t('field.projectName')}
        autoFocus
        disabled={busy}
        onFocus={(e) => { e.target.select() }}
        onChange={(e) => { onTitleChange(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (!saveBlocked) onSave()
          }
        }}
      />
      <div className={css.section}>{t('edit.project.sources')}</div>
      <ul className={css.folders}>
        <li className={css.folderRow}>
          <IconFolderClose16 />
          <span className={css.folderName} title={path}>{folderLabel(path)}</span>
          <span className={css.primary}>{t('edit.project.primary')}</span>
        </li>
        {folders.map(folder => (
          <li className={css.folderRow} key={folder}>
            <IconFolderClose16 />
            <span className={css.folderName} title={folder}>{folderLabel(folder)}</span>
            <button
              type="button"
              className={css.removeFolder}
              aria-label={t('edit.project.removeFolder.aria', { name: folderLabel(folder) })}
              disabled={busy}
              onClick={() => { onRemoveFolder(folder) }}
            >
              <IconCloseOutline16 size={14} />
            </button>
          </li>
        ))}
      </ul>
      {flowAvailable && (
        <button
          type="button"
          className={css.addFolder}
          disabled={busy}
          onClick={onAddFolder}
        >
          <IconProjectAddOutline16 />
          {t('edit.project.addFolder')}
        </button>
      )}
      {duplicateName && (
        <div className={css.error} role="alert">{t('conflict.named', { name: trimmed })}</div>
      )}
      {error !== null && <div className={css.error} role="alert">{error}</div>}
      {busy && <div className={css.status} role="status">{t('edit.project.saving')}</div>}
    </Modal>
  )
}
