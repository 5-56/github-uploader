const { ipcRenderer } = require('electron');

let selectedFolder = null;
let selectedRepo = null;
let repoUrl = null;
let oauthPollingInterval = null;
let deviceCode = null;
let currentAuthUrl = null;

// 页面加载完成后自动尝试登录
document.addEventListener('DOMContentLoaded', async () => {
  // 尝试加载已保存的Token
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

  // 检测Token类型
  if (token.startsWith('github_pat_')) {
    showToast('❌ 这是 Fine-grained Token，不支持创建仓库！请使用 Classic Token (以 ghp_ 开头)', 'error');
    return;
  }

  if (!token.startsWith('ghp_')) {
    showToast('⚠️ Token 格式可能不正确，Classic Token 应以 ghp_ 开头', 'error');
  }

  const btn = event.target.closest('button');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<div class="loader"></div>';
  btn.disabled = true;

  const result = await ipcRenderer.invoke('set-token', token);
  
  if (result.success) {
    onAuthSuccess(result.user);
    showToast('认证成功！欢迎 ' + result.user.login, 'success');
  } else {
    showToast('认证失败: ' + result.error, 'error');
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

// 退出登录
async function logout() {
  await ipcRenderer.invoke('logout');
  document.getElementById('auth-form').classList.remove('hidden');
  document.getElementById('auth-success').classList.add('hidden');
  document.getElementById('upload-section').classList.add('hidden');
  document.getElementById('token-input').value = '';
  resetOAuthUI();
  selectedFolder = null;
  selectedRepo = null;
  showToast('已退出登录', 'info');
}

// ============ OAuth Device Flow ============

// 开始OAuth登录
async function startOAuthLogin() {
  const clientId = document.getElementById('client-id-input').value.trim();
  
  if (!clientId) {
    showToast('请先输入 Client ID！', 'error');
    return;
  }
  
  const btn = document.getElementById('oauth-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="loader"></div> 正在初始化...';

  const result = await ipcRenderer.invoke('start-device-flow', clientId);
  
  if (result.success) {
    deviceCode = result.deviceCode;
    currentAuthUrl = result.verificationUri;
    
    // 显示等待授权界面
    document.getElementById('oauth-section').classList.add('hidden');
    document.getElementById('auth-divider').classList.add('hidden');
    document.getElementById('token-section').classList.add('hidden');
    document.getElementById('oauth-waiting').classList.remove('hidden');
    document.getElementById('user-code').textContent = result.userCode;
    document.getElementById('auth-url').textContent = result.verificationUri;
    
    showToast('请在浏览器中完成授权', 'info');
    
    // 开始轮询检查授权状态
    const interval = (result.interval || 5) * 1000;
    startPolling(result.deviceCode, interval, clientId);
  } else {
    showToast('启动授权失败: ' + result.error, 'error');
    resetOAuthBtn();
  }
}

// 复制授权链接
function copyAuthUrl() {
  if (currentAuthUrl) {
    navigator.clipboard.writeText(currentAuthUrl).then(() => {
      showToast('链接已复制！', 'success');
    });
  }
}

// 重置OAuth按钮
function resetOAuthBtn() {
  const btn = document.getElementById('oauth-btn');
  btn.disabled = false;
  btn.innerHTML = `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg> 🚀 生成授权链接并登录`;
}

// 开始轮询
function startPolling(code, interval, clientId) {
  oauthPollingInterval = setInterval(async () => {
    const result = await ipcRenderer.invoke('poll-device-auth', { deviceCode: code, interval, clientId });
    
    if (result.success) {
      // 授权成功！
      clearInterval(oauthPollingInterval);
      oauthPollingInterval = null;
      
      onAuthSuccess(result.user);
      showToast('🎉 登录成功！欢迎 ' + result.user.login, 'success');
    } else if (result.error) {
      // 出错了
      clearInterval(oauthPollingInterval);
      oauthPollingInterval = null;
      
      showToast(result.error, 'error');
      resetOAuthUI();
    } else if (result.slowDown) {
      // 需要减慢轮询速度
      clearInterval(oauthPollingInterval);
      startPolling(code, interval + 5000);
    }
    // pending 状态继续等待
  }, interval);
}

// 取消OAuth
function cancelOAuth() {
  if (oauthPollingInterval) {
    clearInterval(oauthPollingInterval);
    oauthPollingInterval = null;
  }
  ipcRenderer.send('cancel-device-flow');
  resetOAuthUI();
  showToast('已取消登录', 'info');
}

// 重置OAuth UI
function resetOAuthUI() {
  document.getElementById('oauth-section').classList.remove('hidden');
  document.getElementById('auth-divider').classList.remove('hidden');
  document.getElementById('token-section').classList.remove('hidden');
  document.getElementById('oauth-waiting').classList.add('hidden');
  
  const btn = document.getElementById('oauth-btn');
  btn.disabled = false;
  btn.innerHTML = `<svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg> 🚀 一键 GitHub 授权登录`;
}

// 认证成功后的统一处理
function onAuthSuccess(user) {
  document.getElementById('auth-form').classList.add('hidden');
  document.getElementById('auth-success').classList.remove('hidden');
  document.getElementById('user-avatar').src = user.avatar_url;
  document.getElementById('user-name').textContent = user.name || user.login;
  document.getElementById('user-login').textContent = '@' + user.login;
  
  document.getElementById('upload-section').classList.remove('hidden');
  loadRepos();
}

// 加载仓库列表
async function loadRepos() {
  const select = document.getElementById('repo-select');
  select.innerHTML = '<option value="">加载中...</option>';
  
  const result = await ipcRenderer.invoke('get-repos');
  
  if (result.success) {
    select.innerHTML = '<option value="">-- 选择现有仓库或创建新仓库 --</option>';
    result.repos.forEach(repo => {
      const option = document.createElement('option');
      option.value = repo.name;
      option.textContent = `${repo.private ? '🔒' : '🌍'} ${repo.name}`;
      select.appendChild(option);
    });
  } else {
    select.innerHTML = '<option value="">加载失败</option>';
  }
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

// 上传文件夹
async function uploadFolder() {
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

  const result = await ipcRenderer.invoke('upload-folder', {
    folderPath,
    repoName,
    commitMessage
  });

  uploadBtn.disabled = false;
  uploadBtn.classList.remove('opacity-50', 'cursor-not-allowed');

  if (result.success) {
    repoUrl = result.url;
    document.getElementById('success-info').textContent = `成功上传 ${result.filesCount} 个文件`;
    document.getElementById('success-section').classList.remove('hidden');
    showToast('🎉 上传成功！', 'success');
  } else {
    document.getElementById('progress-section').classList.add('hidden');
    showToast('上传失败: ' + result.error, 'error');
  }
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
