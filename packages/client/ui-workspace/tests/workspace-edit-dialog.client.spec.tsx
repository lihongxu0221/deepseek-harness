// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { folderLabel, WorkspaceEditDialog } from '../src/client/WorkspaceEditDialog.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as never

function mount(overrides: Partial<Parameters<typeof WorkspaceEditDialog>[0]> = {}) {
  const props = {
    open: true,
    title: 'Alpha',
    path: '/projects/alpha',
    folders: ['/projects/extra'],
    busy: false,
    error: null as string | null,
    duplicateName: false,
    flowAvailable: true,
    onTitleChange: vi.fn(),
    onClose: vi.fn(),
    onSave: vi.fn(),
    onRemoveProject: vi.fn(),
    onAddFolder: vi.fn(),
    onRemoveFolder: vi.fn(),
    onSetPrimary: vi.fn(),
    t,
    ...overrides,
  }
  render(<WorkspaceEditDialog {...props} />)
  return props
}

describe('folderLabel', () => {
  it('uses the last path segment and keeps a trailing-slash-only path', () => {
    expect(folderLabel('/projects/alpha')).toBe('alpha')
    expect(folderLabel('C:\\work\\repo\\')).toBe('repo')
    expect(folderLabel('/')).toBe('/')
  })
})

describe('WorkspaceEditDialog', () => {
  it('lists the primary folder, extra folders, and add-folder control', () => {
    const props = mount()
    expect(screen.getByRole('dialog', { name: '编辑项目' })).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('项目名称').value).toBe('Alpha')
    expect(screen.getByText('源文件夹')).toBeTruthy()
    expect(screen.getByText('主要')).toBeTruthy()
    expect(screen.getByTitle('/projects/alpha').textContent).toBe('alpha')
    expect(screen.getByTitle('/projects/extra').textContent).toBe('extra')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '移除文件夹“alpha”' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '设为主要' }))
    expect(props.onSetPrimary).toHaveBeenCalledWith('/projects/extra')
    fireEvent.click(screen.getByRole('button', { name: '移除文件夹“extra”' }))
    expect(props.onRemoveFolder).toHaveBeenCalledWith('/projects/extra')
    fireEvent.click(screen.getByRole('button', { name: '添加文件夹' }))
    expect(props.onAddFolder).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '移除本地项目' }))
    expect(props.onRemoveProject).toHaveBeenCalledOnce()
  })

  it('blocks Save on a blank or duplicate name and Enter commits an allowed draft', () => {
    const props = mount({ title: '   ', duplicateName: false })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(true)
    fireEvent.keyDown(screen.getByLabelText('项目名称'), { key: 'Enter' })
    expect(props.onSave).not.toHaveBeenCalled()

    cleanup()
    const duplicate = mount({ title: 'Beta', duplicateName: true })
    expect(screen.getByRole('alert').textContent).toBe('已存在名为“Beta”的工作区。')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(duplicate.onSave).not.toHaveBeenCalled()

    cleanup()
    const ready = mount()
    fireEvent.keyDown(screen.getByLabelText('项目名称'), { key: 'Enter' })
    expect(ready.onSave).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(ready.onClose).toHaveBeenCalledOnce()
  })

  it('hides add-folder when the directory flow is unoccupied and disables controls while busy', () => {
    mount({ flowAvailable: false, busy: true, error: 'denied' })
    expect(screen.queryByRole('button', { name: '添加文件夹' })).toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>('项目名称').disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '移除本地项目' }).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('正在保存…')
    expect(screen.getByRole('alert').textContent).toBe('denied')
  })
})
