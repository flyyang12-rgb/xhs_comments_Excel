# 小红书采集与分析工具

这个仓库里有两个互相独立的工具，功能不一样，按需要选一个用就行，不需要两个一起运行。

## 两个文件夹有什么区别

### `xhs_comments_Excel_repo`

这是 Chrome 插件，用来采集小红书笔记和评论，并导出原始 Excel。

普通使用直接进入这个文件夹，双击 `启动采集工具.bat`，再按里面的 README 操作。

### `xhs_comments_Excel_py`

这是 Python 分析工具，用来采集并分析儿童大披肩防晒帽相关内容，最后分别导出好评和差评 Excel。

使用前先把 `.env.example` 复制成 `.env`，填入自己的 API 密钥，再双击 `启动采集.bat`。

## 一句话选择

- 想采集原始笔记和评论：用 `xhs_comments_Excel_repo`。
- 想分析好评和差评：用 `xhs_comments_Excel_py`。

两个项目的代码、配置和输出都各放各的，不会混在一起。

## 下载

为了同时下载 Python 工具依赖的采集模块，请使用：

```bash
git clone --recurse-submodules -b agent/new-computer-setup https://github.com/flyyang12-rgb/xhs_comments_Excel.git
```

如果是下载 GitHub 提供的 ZIP，`xhs_comments_Excel_py/vendor/Spider_XHS` 可能为空，建议使用上面的 Git 命令下载。
