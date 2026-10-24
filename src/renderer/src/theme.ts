import type { ThemeConfig } from 'antd'

export const palette = {
  primary: '#8A6B3B',
  primaryActive: '#715830',
  primaryOpacity: 'rgba(156,124,74,.08)',
  pageBg: '#FAF5EA',
  panelBg: '#FFFFFF',
  folderBg: '#F3EAD8',
  folderHover: 'rgba(156,124,74,.14)',
  headerBg: '#F4EDDF',
  border: 'rgba(147,117,63,.16)',
  borderLight: 'rgba(147,117,63,.32)',
  text: '#2C2214',
  textSecondary: '#6B5D48',
  textMuted: '#9C9080',
  success: '#26CEA4',
  error: '#ff583e',
  warning: '#ffb400'
}

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: palette.primary,
    colorInfo: palette.primary,
    colorSuccess: palette.success,
    colorError: palette.error,
    colorWarning: palette.warning,
    colorBgBase: palette.pageBg,
    colorBgContainer: palette.panelBg,
    colorText: palette.text,
    colorTextSecondary: palette.textSecondary,
    colorBorder: palette.border,
    colorBorderSecondary: palette.border,
    colorSplit: palette.border,
    borderRadius: 4,
    fontSize: 13,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif",
    controlHeight: 30
  },
  components: {
    Button: {
      primaryShadow: 'none',
      defaultShadow: 'none',
      fontWeight: 500
    },
    Input: {
      activeShadow: 'none',
      hoverBorderColor: palette.borderLight,
      activeBorderColor: palette.primary
    },
    Select: {
      optionSelectedBg: palette.primaryOpacity
    },
    Table: {
      headerBg: palette.folderBg,
      headerColor: palette.textSecondary,
      rowHoverBg: palette.folderHover,
      cellPaddingBlockSM: 6,
      cellPaddingInlineSM: 8
    },
    Tabs: {
      itemSelectedColor: palette.primary,
      itemHoverColor: palette.primary,
      inkBarColor: palette.primary,
      titleFontSize: 13
    },
    Tree: {
      nodeSelectedBg: palette.folderHover,
      nodeHoverBg: 'transparent',
      directoryNodeSelectedBg: palette.folderHover
    },
    Segmented: {
      itemSelectedBg: palette.folderBg,
      itemSelectedColor: palette.primary
    }
  }
}
