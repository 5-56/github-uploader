const { ipcRenderer } = require('electron');

let selectedFolder = null;
let selectedRepo = null;
let repoUrl = null;
let currentUser = null;
let allRepos = [];
let currentBrowsingRepo = null;
let currentPath = [];
let pathHistory = [];

// 页面加载完成后自动尝试登录
document.addEventListener('DOMContentLoaded', async () => {
  const result = await ipcRenderer.invoke('load-saved-token');
  if (result.success) {
    onAuthSuccess(result.user);
    showToast('👋 欢迎回来，' + result.user.login + '！', 'success');
  }
});

// 窗口控制
function windowControl(action) {
  ipcRenderer.send(`window-${action}`);
}

// 打开外部链接
function openExternal(url) {
  ipcRenderer.send('open-external', url);
}

// 认证
async function authenticate() {
  const token = document.getElementById('token-input').value.trim();
  if (!token) {
    showToast('请输入 Token！', 'error');
    return;
  }

  if (token.startsWith('github_pat_')) {
    showToast('❌ Fine-grained Token 不支持，请用 Classic Token (ghp_开头)', 'error');
    return;
  }

  const btn = document.getElementById('login-btn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<div class="loader"></div>';
  btn.disabled = true;

  const result = await ipcRenderer.invoke('set-token', token);
  
  if (result.success) {
    onAuthSuccess(result.user);
    showToast('✅ 登录成功！', 'success');
  } else {
    showToast('认证失败: ' + result.error, 'error');
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

// 退出登录
async function logout() {
  await ipcRenderer.invoke('logout');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('main-app').classList.add('hidden');
  document.getElementById('header-user').classList.add('hidden');
  document.getElementById('token-input').value = '';
  selectedFolder = null;
  selectedRepo = null;
  currentUser = null;
  allRepos = [];
  showToast('已退出登录', 'info');
}

// 认证成功后的统一处理
function onAuthSuccess(user) {
  currentUser = user;
  
  // 隐藏登录界面，显示主界面
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  
  // 更新顶部用户信息
  document.getElementById('header-user').classList.remove('hidden');
  document.getElementById('header-avatar').src = user.avatar_url;
  document.getElementById('header-login').textContent = user.login;
  
  // 加载仓库
  loadRepos();
}

// 加载仓库列表
async function loadRepos() {
  const select = document.getElementById('repo-select');
  const repoListEl = document.getElementById('repo-list');
  
  select.innerHTML = '<option value="">加载中...</option>';
  repoListEl.innerHTML = '<div class="text-center text-gray-500 py-8"><div class="loader mx-auto mb-2"></div><p class="text-sm">加载中...</p></div>';
  
  const result = await ipcRenderer.invoke('get-repos');
  
  if (result.success) {
    allRepos = result.repos;
    
    // 更新左侧下拉选择
    select.innerHTML = '<option value="">-- 选择仓库 --</option>';
    result.repos.forEach(repo => {
      const option = document.createElement('option');
      option.value = repo.name;
      option.textContent = `${repo.private ? '🔒' : '🌍'} ${repo.name}`;
      select.appendChild(option);
    });
    
    // 更新右侧仓库列表
    renderRepoList(result.repos);
  } else {
    select.innerHTML = '<option value="">加载失败</option>';
    repoListEl.innerHTML = '<div class="text-center text-gray-500 py-8"><p class="text-sm">加载失败</p></div>';
  }
}

// 渲染右侧仓库列表
function renderRepoList(repos) {
  const repoListEl = document.getElementById('repo-list');
  
  if (repos.length === 0) {
    repoListEl.innerHTML = '<div class="text-center text-gray-500 py-8"><p class="text-sm">暂无仓库</p></div>';
    return;
  }
  
  repoListEl.innerHTML = repos.map(repo => `
    <div class="file-item p-2 rounded cursor-pointer border-l-2 border-transparent hover:border-github-blue" onclick="browseRepo('${repo.name}')">
      <div class="flex items-center gap-2">
        <svg class="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h18v18H3V3zm16 16V5H5v14h14z"/></svg>
        <span class="text-sm font-medium truncate">${repo.name}</span>
        ${repo.private ? '<span class="text-xs text-yellow-500">🔒</span>' : ''}
      </div>
      <div class="text-xs text-gray-500 mt-1 truncate">${repo.description || '无描述'}</div>
    </div>
  `).join('');
}

// 浏览仓库内容
async function browseRepo(repoName) {
  currentBrowsingRepo = repoName;
  currentPath = [];
  pathHistory = [];
  
  document.getElementById('file-browser-header').classList.remove('hidden');
  document.getElementById('current-repo-name').textContent = repoName;
  document.getElementById('current-path').textContent = '';
  document.getElementById('back-btn').classList.add('hidden');
  
  await loadRepoContents(repoName, '');
}

// 加载仓库内容
async function loadRepoContents(repoName, path) {
  const contentEl = document.getElementById('file-content');
  contentEl.innerHTML = '<div class="text-center py-8"><div class="loader mx-auto mb-2"></div><p class="text-sm text-gray-500">加载中...</p></div>';
  
  const result = await ipcRenderer.invoke('get-repo-contents', { repoName, path });
  
  if (result.success) {
    renderFileList(result.contents, repoName);
  } else {
    if (result.empty) {
      contentEl.innerHTML = '<div class="text-center text-gray-500 py-16"><svg class="w-12 h-12 mx-auto mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"/></svg><p>仓库为空</p><p class="text-xs mt-2">可以上传文件到这个仓库</p></div>';
    } else {
      contentEl.innerHTML = `<div class="text-center text-gray-500 py-16"><p>加载失败: ${result.error}</p></div>`;
    }
  }
}

// 渲染文件列表
function renderFileList(contents, repoName) {
  const contentEl = document.getElementById('file-content');
  
  // 排序：文件夹在前，文件在后
  const sorted = contents.sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1;
    if (a.type !== 'dir' && b.type === 'dir') return 1;
    return a.name.localeCompare(b.name);
  });
  
  contentEl.innerHTML = `
    <div class="file-tree">
      ${sorted.map(item => `
        <div class="file-item flex items-center gap-3 p-2 rounded cursor-pointer" onclick="${item.type === 'dir' ? `openFolder('${repoName}', '${item.path}')` : `viewFile('${repoName}', '${item.path}', '${item.name}')`}">
          ${item.type === 'dir' 
            ? '<svg class="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>'
            : '<svg class="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>'
          }
          <span class="flex-1 truncate">${item.name}</span>
          ${item.size ? `<span class="text-xs text-gray-500">${formatSize(item.size)}</span>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

// 打开文件夹
async function openFolder(repoName, path) {
  pathHistory.push(currentPath.join('/'));
  currentPath = path.split('/').filter(p => p);
  
  document.getElementById('current-path').textContent = currentPath.join(' / ');
  document.getElementById('back-btn').classList.remove('hidden');
  
  await loadRepoContents(repoName, path);
}

// 返回上级
async function goBack() {
  if (pathHistory.length > 0) {
    const prevPath = pathHistory.pop();
    currentPath = prevPath ? prevPath.split('/') : [];
    document.getElementById('current-path').textContent = currentPath.join(' / ');
    
    if (pathHistory.length === 0 && currentPath.length === 0) {
      document.getElementById('back-btn').classList.add('hidden');
    }
    
    await loadRepoContents(currentBrowsingRepo, prevPath);
  }
}

// 查看文件内容
async function viewFile(repoName, path, fileName) {
  const contentEl = document.getElementById('file-content');
  contentEl.innerHTML = '<div class="text-center py-8"><div class="loader mx-auto mb-2"></div><p class="text-sm text-gray-500">加载文件...</p></div>';
  
  const result = await ipcRenderer.invoke('get-file-content', { repoName, path });
  
  if (result.success) {
    const ext = fileName.split('.').pop().toLowerCase();
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext);
    
    if (isImage) {
      contentEl.innerHTML = `<div class="text-center"><img src="data:image/${ext};base64,${result.content}" class="max-w-full max-h-96 mx-auto rounded border border-github-border"></div>`;
    } else {
      const lines = atob(result.content).split('\n');
      contentEl.innerHTML = `
        <div class="bg-github-gray rounded border border-github-border overflow-auto">
          <div class="p-3 border-b border-github-border text-sm text-gray-400">${fileName}</div>
          <pre class="code-view p-4 overflow-x-auto"><code>${lines.map((line, i) => `<span class="line-number inline-block w-8 text-right mr-4">${i + 1}</span>${escapeHtml(line)}`).join('\n')}</code></pre>
        </div>
      `;
    }
    
    // 添加返回按钮
    const backLink = document.createElement('button');
    backLink.className = 'text-github-blue text-sm hover:underline mt-4 block';
    backLink.textContent = '← 返回文件列表';
    backLink.onclick = () => loadRepoContents(repoName, currentPath.join('/'));
    contentEl.appendChild(backLink);
  } else {
    contentEl.innerHTML = `<div class="text-center text-gray-500 py-16"><p>无法加载文件: ${result.error}</p></div>`;
  }
}

// HTML转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 格式化文件大小
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 选择文件夹
async function selectFolder() {
  const result = await ipcRenderer.invoke('select-folder');
  if (result) {
    selectedFolder = result;
    document.getElementById('folder-path').value = result;
    
    // 自动填充仓库名建议
    const folderName = result.split(/[/\\]/).pop();
    if (!document.getElementById('new-repo-name').value) {
      document.getElementById('new-repo-name').value = folderName;
    }
  }
}

// 切换新建仓库表单
function toggleNewRepo() {
  const form = document.getElementById('new-repo-form');
  const btn = document.getElementById('new-repo-btn');
  
  if (form.classList.contains('hidden')) {
    form.classList.remove('hidden');
    btn.textContent = '取消';
    btn.classList.add('bg-red-600', 'hover:bg-red-700');
    btn.classList.remove('hover:bg-gray-600');
    document.getElementById('repo-select').disabled = true;
  } else {
    form.classList.add('hidden');
    btn.textContent = '+ 新建';
    btn.classList.remove('bg-red-600', 'hover:bg-red-700');
    btn.classList.add('hover:bg-gray-600');
    document.getElementById('repo-select').disabled = false;
  }
}

// 创建新仓库
async function createRepo() {
  const name = document.getElementById('new-repo-name').value.trim();
  const description = document.getElementById('new-repo-desc').value.trim();
  const isPrivate = document.querySelector('input[name="visibility"]:checked').value === 'private';
  
  if (!name) {
    showToast('请输入仓库名称！', 'error');
    return;
  }

  const btn = event.target;
  const originalText = btn.innerHTML;
  btn.innerHTML = '<div class="loader mx-auto"></div>';
  btn.disabled = true;

  const result = await ipcRenderer.invoke('create-repo', { name, description, isPrivate });
  
  if (result.success) {
    showToast('仓库创建成功！', 'success');
    toggleNewRepo();
    await loadRepos();
    document.getElementById('repo-select').value = name;
    selectedRepo = name;
  } else {
    showToast('创建失败: ' + result.error, 'error');
  }
  
  btn.innerHTML = originalText;
  btn.disabled = false;
}

// 上传文件夹（支持重试）
async function uploadFolder(isRetry = false) {
  const folderPath = document.getElementById('folder-path').value;
  const repoName = document.getElementById('repo-select').value || document.getElementById('new-repo-name').value;
  const commitMessage = document.getElementById('commit-message').value;

  if (!folderPath) {
    showToast('请先选择文件夹！', 'error');
    return;
  }

  if (!repoName) {
    showToast('请选择或创建一个仓库！', 'error');
    return;
  }

  // 禁用上传按钮
  const uploadBtn = document.getElementById('upload-btn');
  uploadBtn.disabled = true;
  uploadBtn.classList.add('opacity-50', 'cursor-not-allowed');

  // 显示进度
  document.getElementById('progress-section').classList.remove('hidden');
  document.getElementById('success-section').classList.add('hidden');

  if (isRetry) {
    showToast('正在重试上传...', 'info');
  }

  const result = await ipcRenderer.invoke('upload-folder', {
    folderPath,
    repoName,
    commitMessage
  });

  uploadBtn.disabled = false;
  uploadBtn.classList.remove('opacity-50', 'cursor-not-allowed');

  if (result.success) {
    repoUrl = result.url;
    document.getElementById('success-section').classList.remove('hidden');
    showToast('🎉 上传成功！', 'success');
    
    // 刷新仓库列表
    loadRepos();
  } else {
    document.getElementById('progress-section').classList.add('hidden');
    
    // 如果可以重试，显示重试按钮
    if (result.canRetry) {
      showToastWithRetry(result.error);
    } else {
      showToast('上传失败: ' + result.error, 'error');
    }
  }
}

// 显示带重试按钮的Toast
function showToastWithRetry(errorMsg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast fixed bottom-6 right-6 px-6 py-4 rounded-lg shadow-xl z-50 fade-in bg-red-600 max-w-md';
  toast.innerHTML = `
    <div class="flex flex-col gap-3">
      <div class="flex items-start gap-2">
        <svg class="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
        </svg>
        <div class="flex-1">
          <p class="font-medium">上传失败</p>
          <p class="text-sm mt-1 opacity-90">${errorMsg}</p>
          <p class="text-xs mt-1 opacity-75">已保存进度，可以继续上传</p>
        </div>
      </div>
      <button onclick="retryUpload()" class="bg-white text-red-600 px-4 py-2 rounded font-medium hover:bg-gray-100 transition-colors">
        🔄 重试上传
      </button>
    </div>
  `;
  document.body.appendChild(toast);
}

// 重试上传
function retryUpload() {
  const toast = document.querySelector('.toast');
  if (toast) toast.remove();
  uploadFolder(true);
}

// 打开仓库
function openRepo() {
  if (repoUrl) {
    openExternal(repoUrl);
  }
}

// 监听上传进度
ipcRenderer.on('upload-progress', (event, { message, percent }) => {
  document.getElementById('progress-text').textContent = message;
  document.getElementById('progress-percent').textContent = percent + '%';
  document.getElementById('progress-bar').style.width = percent + '%';
});

// Toast 提示
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast fixed bottom-6 right-6 px-6 py-3 rounded-lg shadow-xl z-50 fade-in ${
    type === 'success' ? 'bg-green-600' : 
    type === 'error' ? 'bg-red-600' : 'bg-github-blue'
  }`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 仓库选择变化
document.getElementById('repo-select').addEventListener('change', (e) => {
  selectedRepo = e.target.value;
});
