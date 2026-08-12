# 小红书关键词笔记与评论采集

本仓库提供两种采集方式：推荐使用 Chrome 插件完成关键词搜索、评论采集和 Excel 导出；同时保留原有 Python 脚本作为独立工作流。

## Chrome 插件（推荐）

### 环境要求

- Windows 10/11
- Chrome
- Node.js（建议使用当前 LTS 版本）
- 已登录小红书的 Chrome 会话

### 使用步骤

1. 安装 [Node.js](https://nodejs.org/)。
2. 双击 `启动采集工具.bat`，保持签名服务窗口打开。
3. 在 Chrome 打开 `chrome://extensions/`，开启开发者模式。
4. 点击“加载已解压的扩展程序”，选择 `xhs_chrome_extension`。
5. 登录小红书，打开插件，输入关键词并选择“最新 / 最多点赞 / 最多评论”。
6. 采集完成后导出 `notes_raw.xlsx` 和 `comments_raw.xlsx`。

更详细的插件说明见 [`xhs_chrome_extension/README.md`](xhs_chrome_extension/README.md)。

## 文档

- [快速使用指南](docs/快速使用指南.md)
- [AI 应用案例申报模板](docs/AI应用案例申报模板.md)
- [Python 旧版工作流](docs/Python旧版工作流.md)
- [文档索引](docs/README.md)

## Python 脚本（旧版工作流）

安装依赖：

```powershell
pip install DrissionPage openpyxl requests
npm install
```

依次运行：

```powershell
python "小红书_ 关键词采集.py"
python "小红书_comments_raw采集.py"
```

## 数据与账号安全

- `xhs_cookies.txt`、Excel/CSV 采集结果、依赖目录和本地 Node 运行时已被 `.gitignore` 排除。
- 插件只在本机读取当前 Chrome 登录态，并通过 `127.0.0.1:18765` 调用本地签名服务。
- 请遵守目标平台规则、适用法律和合理的请求频率；验证码或安全限制出现时应停止采集。
