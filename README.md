# 🚀 GitHub Uploader

一键上传文件夹到 GitHub 的桌面应用程序。

![Preview](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![Electron](https://img.shields.io/badge/Electron-28.0-47848F)

## ✨ 功能特点

- 📁 **一键选择文件夹** - 简单的文件夹选择器
- 🔐 **安全认证** - 使用 GitHub Personal Access Token
- 📦 **创建新仓库** - 直接在应用内创建公开/私有仓库
- ⚡ **快速上传** - 高效的 Git API 上传方式
- 📊 **实时进度** - 上传进度可视化
- 🎨 **现代UI** - GitHub 风格的深色主题界面

## 🛠️ 安装

```bash
# 克隆项目
git clone https://github.com/yourusername/github-uploader.git
cd github-uploader

# 安装依赖
npm install

# 构建 CSS
npm run build:css

# 启动应用
npm start
```

## 🔑 获取 GitHub Token

1. 访问 [GitHub Token 设置页面](https://github.com/settings/tokens/new)
2. 勾选 `repo` 权限
3. 点击 "Generate token"
4. 复制生成的 Token 到应用中

## 📖 使用方法

1. **输入 Token** - 粘贴你的 GitHub Personal Access Token
2. **选择文件夹** - 点击"浏览"选择要上传的文件夹
3. **选择/创建仓库** - 选择现有仓库或创建新仓库
4. **点击上传** - 一键上传所有文件！

## 🎯 技术栈

- **Electron** - 跨平台桌面应用框架
- **TailwindCSS** - 实用优先的 CSS 框架
- **Octokit** - GitHub 官方 API 客户端
- **Simple-Git** - Git 操作库

## ⚠️ 注意事项

- 自动忽略 `.git`、`node_modules` 和 `.DS_Store`
- Token 仅在内存中使用，不会被保存
- 建议先在空仓库或新仓库测试

## 📝 License

MIT License
