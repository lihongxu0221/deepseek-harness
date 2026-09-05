/** `settings.desktopUpdate` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '桌面更新',
  'description': '检查 GitHub 是否有新的打包 zip。更新会替换程序文件，并保留 .config 中的会话与插件。',
  'current': '当前版本',
  'latest': '最新版本',
  'check': '检查更新',
  'checking': '正在检查',
  'download': '下载',
  'downloading': '正在下载',
  'apply': '退出并更新',
  'ready': '已下载，退出后替换程序文件',
  'upToDate': '已是最新打包',
  'outdated': '发现新的打包',
  'unavailable': '当前不是打包桌面',
} satisfies Record<string, string>

/** The settings.desktopUpdate namespace key union. */
export type DesktopUpdateKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Desktop update',
  'description': 'Check GitHub for a newer packaged zip. An update replaces program files and keeps sessions and plugins in .config.',
  'current': 'Current version',
  'latest': 'Latest version',
  'check': 'Check for updates',
  'checking': 'Checking',
  'download': 'Download',
  'downloading': 'Downloading',
  'apply': 'Quit and update',
  'ready': 'Downloaded. Quit to replace program files.',
  'upToDate': 'This pack is current',
  'outdated': 'A newer pack is available',
  'unavailable': 'Not a packaged desktop',
} satisfies Record<DesktopUpdateKey, string>
