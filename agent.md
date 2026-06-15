# 小红书儿童泳衣笔记及评论采集项目说明

## 1. 项目用途

本项目用于采集小红书搜索结果中的儿童泳衣相关笔记，并基于采集到的笔记链接继续采集一级评论数据。

当前主流程分为两步：

1. 运行关键词采集脚本，生成或追加写入 `notes_raw.xlsx`。
2. 运行评论采集脚本，读取 `notes_raw.xlsx` 中的笔记链接，生成或追加写入 `comments_raw.xlsx`。

## 2. 项目文件

| 文件 | 说明 |
| --- | --- |
| `小红书_ 关键词采集.py` | 按关键词搜索小红书笔记，采集笔记基础信息。 |
| `小红书_comments_raw采集.py` | 基于 `notes_raw.xlsx` 中的笔记链接采集一级评论。 |
| `notes_raw.xlsx` | 笔记采集结果表，工作表名为 `notes_raw`。 |
| `comments_raw.xlsx` | 评论采集结果表，工作表名为 `comments_raw`。 |
| `xhs_cookies.txt` | 小红书登录 Cookie 缓存文件，用于评论接口请求。 |
| `xhs_sign.js` | 生成小红书请求签名的 Node.js 脚本。 |
| `xhs_main_260411.js` | 小红书签名相关 JS 依赖文件。 |
| `package.json` | Node.js 依赖配置，目前使用 `crypto-js`。 |
| `notes_raw_备份.xlsx` | 评论采集脚本运行前自动生成的笔记表备份。 |

## 3. 运行环境

### Python

当前项目使用 Python 3.9 运行，示例路径：

```powershell
C:\Users\20898\AppData\Local\Programs\Python\Python39\python.exe
```

需要的 Python 包：

```powershell
pip install DrissionPage openpyxl requests
```

### Node.js

评论采集脚本会调用 `node xhs_sign.js` 生成请求签名，需要安装 Node.js。

项目依赖：

```powershell
npm install
```

## 4. 数据表说明

### notes_raw.xlsx

文件名：`notes_raw.xlsx`

工作表名：`notes_raw`

字段：

| 字段 | 说明 |
| --- | --- |
| 采集批次 | 本次采集批次，包含日期和关键词。 |
| 采集时间 | 笔记采集时间。 |
| 搜索关键词 | 当前搜索关键词。 |
| 关键词下排名 | 该笔记在当前关键词结果中的排名。 |
| 笔记链接 | 小红书笔记详情链接，包含 `xsec_token`。 |
| 笔记标题 | 笔记标题。 |
| 作者昵称 | 作者昵称。 |
| 评论数 | 搜索结果中展示的评论数。 |
| 采集状态 | 笔记采集状态，成功时为 `成功`。 |
| 评论50条采集完成 | 评论采集进度列，由评论采集脚本自动写入。 |

说明：

- `小红书_ 关键词采集.py` 会自动创建 `notes_raw.xlsx`。
- 如果文件不存在或不是有效 Excel，会自动重建。
- 每次运行会继续向 `notes_raw` 表追加新数据。

### comments_raw.xlsx

文件名：`comments_raw.xlsx`

工作表名：`comments_raw`

字段：

| 字段 | 说明 |
| --- | --- |
| 笔记链接 | 评论所属笔记链接。 |
| 评论序号 | 当前笔记下的评论序号。 |
| 评论内容 | 一级评论文本。 |
| 评论图片链接 | 评论中携带的图片链接，多个链接用换行分隔。 |
| 评论采集状态 | 评论采集状态，如 `成功`、`失败`、`无评论`、`加载失败`。 |

## 5. 使用步骤

### 第一步：采集笔记

运行：

```powershell
C:\Users\20898\AppData\Local\Programs\Python\Python39\python.exe "D:\AI_Project\02小红书儿童太阳镜笔记及评论采集需求\小红书_ 关键词采集.py"
```

脚本会使用下面这些关键词进行搜索：

- 儿童泳衣推荐
- 女童泳衣推荐
- 男童泳衣推荐
- 儿童泳衣测评
- 儿童泳衣怎么选
- 儿童泳衣防晒
- 儿童泳衣连体
- 儿童泳衣分体

每个关键词默认采集前 10 条笔记。

### 第二步：采集评论

运行：

```powershell
C:\Users\20898\AppData\Local\Programs\Python\Python39\python.exe "D:\AI_Project\02小红书儿童太阳镜笔记及评论采集需求\小红书_comments_raw采集.py"
```

默认行为：

- 读取 `notes_raw.xlsx`。
- 输出到 `comments_raw.xlsx`。
- 每篇笔记最多采集 50 条一级评论。
- 每篇笔记采集完成后等待 35 秒。
- 已完成评论采集的笔记，会在 `notes_raw.xlsx` 中标记进度，后续重复运行会跳过。

常用参数：

```powershell
# 每篇笔记最多采集 20 条评论
C:\Users\20898\AppData\Local\Programs\Python\Python39\python.exe "D:\AI_Project\02小红书儿童太阳镜笔记及评论采集需求\小红书_comments_raw采集.py" --max-comments 20

# 只处理前 3 篇笔记，适合测试
C:\Users\20898\AppData\Local\Programs\Python\Python39\python.exe "D:\AI_Project\02小红书儿童太阳镜笔记及评论采集需求\小红书_comments_raw采集.py" --limit-notes 3

# 调整每篇笔记之间的等待时间
C:\Users\20898\AppData\Local\Programs\Python\Python39\python.exe "D:\AI_Project\02小红书儿童太阳镜笔记及评论采集需求\小红书_comments_raw采集.py" --sleep 60
```

## 6. Cookie 说明

评论采集需要登录态。

脚本默认读取：

```text
xhs_cookies.txt
```

如果该文件不存在，脚本会打开浏览器访问第一篇笔记，等待用户登录小红书，然后把 Cookie 保存到 `xhs_cookies.txt`。

如果评论采集频繁失败，可以尝试：

1. 删除旧的 `xhs_cookies.txt`。
2. 重新运行评论采集脚本。
3. 在浏览器中重新登录小红书。

## 7. 常见问题

### 1. `BadZipFile: File is not a zip file`

原因：`notes_raw.xlsx` 不是有效 Excel 文件，可能是文本文件被误命名成 `.xlsx`。

处理：当前关键词采集脚本已经加入自动修复逻辑，重新运行即可自动创建有效的 `notes_raw.xlsx`。

### 2. 控制台中文乱码

原因：Windows 控制台编码与脚本输出编码不一致。

说明：只要 Excel 打开后中文正常，一般不影响采集结果。

可选处理：

```powershell
chcp 65001
```

然后重新运行脚本。

### 3. 评论采集遇到安全限制或 461

原因：请求过快、登录态异常、接口触发风控。

建议：

- 增大 `--sleep` 参数，例如 `--sleep 60`。
- 稍后再运行。
- 重新获取 Cookie。
- 不要同时运行多个采集脚本。

### 4. 评论采集重复运行会不会重复采集？

评论脚本会在 `notes_raw.xlsx` 中写入进度列 `评论50条采集完成`。

已经标记完成的笔记，下次运行会跳过。

## 8. 维护注意事项

- 修改关键词时，编辑 `小红书_ 关键词采集.py` 中的 `keywords` 列表。
- 修改每个关键词采集数量时，调整 `parse_notes()` 中的 `if rank > 10:`。
- 修改评论采集数量时，优先使用评论脚本参数 `--max-comments`。
- 不要手动删除 `notes_raw.xlsx` 中的 `笔记链接` 字段，否则评论采集无法继续。
- 小红书页面结构和接口可能变化，如果搜索采集失败，需要检查页面元素选择器和接口监听地址。
- `xhs_sign.js`、`xhs_main_260411.js` 与评论接口签名相关，除非明确知道影响，不建议随意改动。

## 9. Agent 工作约定

后续 Agent 维护本项目时，请遵循：

1. 优先保证 Excel 表结构稳定，不随意改字段名。
2. 修改脚本前先备份关键数据文件，尤其是 `notes_raw.xlsx` 和 `comments_raw.xlsx`。
3. 采集脚本异常时，先判断是环境问题、Cookie 问题、风控问题，还是页面接口变化。
4. 只对当前需求做小范围修改，避免重写整套采集逻辑。
5. 修改后至少做一次轻量验证，例如导入脚本、检查 Excel 工作表和表头。
