const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { Octokit } = require('@octokit/rest');
const simpleGit = require('simple-git');

let mainWindow;
let octokit = null;
let currentUser = null;
let deviceFlowPolling = null;

// 配置文件路径
let configPath = null;

// 保存Token到本地
function saveToken(token) {
  try {
    const config = { token, savedAt: new Date().toISOString() };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Failed to save token:', e);
  }
}

// 读取本地Token
function loadToken() {
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config.token;
    }
  } catch (e) {
    console.error('Failed to load token:', e);
  }
  return null;
}

// 清除本地Token
function clearToken() {
  try {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  } catch (e) {
    console.error('Failed to clear token:', e);
  }
}

// GitHub OAuth App Client ID (公开的，可以硬编码)
// 用户也可以使用自己的 OAuth App
const GITHUB_CLIENT_ID = 'Ov23liUzfCqAOuntXmgG';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0d1117',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, 'assets/icon.png')
  });

  mainWindow.loadFile('src/index.html');
}

app.whenReady().then(() => {
  // 初始化配置文件路径
  configPath = path.join(app.getPath('userData'), 'github-uploader-config.json');
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// 窗口控制
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.on('window-close', () => mainWindow.close());

// 选择文件夹
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// 设置GitHub Token
ipcMain.handle('set-token', async (event, token, rememberMe = true) => {
  try {
    octokit = new Octokit({ auth: token });
    const { data } = await octokit.rest.users.getAuthenticated();
    currentUser = data;
    // 保存Token到本地
    if (rememberMe) {
      saveToken(token);
    }
    return { success: true, user: data };
  } catch (error) {
    octokit = null;
    currentUser = null;
    return { success: false, error: error.message };
  }
});

// 加载已保存的Token
ipcMain.handle('load-saved-token', async () => {
  const token = loadToken();
  if (token) {
    try {
      octokit = new Octokit({ auth: token });
      const { data } = await octokit.rest.users.getAuthenticated();
      currentUser = data;
      return { success: true, user: data, token };
    } catch (error) {
      // Token已失效，清除
      clearToken();
      octokit = null;
      currentUser = null;
      return { success: false, error: 'Token已失效' };
    }
  }
  return { success: false, error: '无保存的Token' };
});

// 退出登录并清除Token
ipcMain.handle('logout', async () => {
  clearToken();
  octokit = null;
  currentUser = null;
  return { success: true };
});

// 获取用户仓库列表
ipcMain.handle('get-repos', async () => {
  if (!octokit) return { success: false, error: '未认证' };
  try {
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 100
    });
    return { success: true, repos: data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 创建新仓库
ipcMain.handle('create-repo', async (event, { name, description, isPrivate }) => {
  if (!octokit) return { success: false, error: '未认证' };
  try {
    const { data } = await octokit.rest.repos.createForAuthenticatedUser({
      name,
      description: description || '',
      private: isPrivate,
      auto_init: false
    });
    return { success: true, repo: data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 上传文件夹到GitHub
ipcMain.handle('upload-folder', async (event, { folderPath, repoName, branch = 'main', commitMessage }) => {
  if (!octokit || !currentUser) {
    return { success: false, error: '未认证' };
  }

  const owner = currentUser.login;
  
  try {
    // 发送进度更新
    const sendProgress = (message, percent) => {
      mainWindow.webContents.send('upload-progress', { message, percent });
    };

    sendProgress('正在准备上传...', 5);

    // 获取所有文件
    const files = [];
    const getAllFiles = (dir, baseDir = dir) => {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        // 忽略 .git 文件夹和 node_modules
        if (item === '.git' || item === 'node_modules' || item === '.DS_Store') continue;
        
        const fullPath = path.join(dir, item);
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          getAllFiles(fullPath, baseDir);
        } else {
          files.push({ path: relativePath, fullPath });
        }
      }
    };

    getAllFiles(folderPath);
    sendProgress(`找到 ${files.length} 个文件`, 10);

    if (files.length === 0) {
      return { success: false, error: '文件夹为空或只包含被忽略的文件' };
    }

    // 检查仓库是否存在，尝试获取默认分支
    let defaultBranch = branch;
    let repoExists = false;
    try {
      const { data: repoData } = await octokit.rest.repos.get({ owner, repo: repoName });
      defaultBranch = repoData.default_branch;
      repoExists = true;
      sendProgress('仓库已存在，准备更新...', 15);
    } catch (e) {
      sendProgress('将创建新仓库...', 15);
    }

    // 获取或创建基础树
    let baseTree = null;
    let parentSha = null;
    let isEmptyRepo = false;

    if (repoExists) {
      try {
        const { data: refData } = await octokit.rest.git.getRef({
          owner,
          repo: repoName,
          ref: `heads/${defaultBranch}`
        });
        parentSha = refData.object.sha;

        const { data: commitData } = await octokit.rest.git.getCommit({
          owner,
          repo: repoName,
          commit_sha: parentSha
        });
        baseTree = commitData.tree.sha;
      } catch (e) {
        // 仓库是空的，需要先创建初始提交
        isEmptyRepo = true;
        sendProgress('仓库为空，正在初始化...', 18);
      }
    } else {
      isEmptyRepo = true;
    }

    // 如果仓库为空，使用 createOrUpdateFileContents 逐个上传文件
    if (isEmptyRepo) {
      sendProgress('正在上传文件到空仓库...', 20);
      const totalFiles = files.length;
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const content = fs.readFileSync(file.fullPath);
        const base64Content = content.toString('base64');
        
        try {
          await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo: repoName,
            path: file.path,
            message: i === 0 ? (commitMessage || 'Initial commit from GitHub Uploader') : `Add ${file.path}`,
            content: base64Content,
            branch: defaultBranch
          });
        } catch (e) {
          // 如果分支不存在，尝试不指定分支
          await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo: repoName,
            path: file.path,
            message: i === 0 ? (commitMessage || 'Initial commit from GitHub Uploader') : `Add ${file.path}`,
            content: base64Content
          });
        }
        
        const percent = 20 + Math.floor(((i + 1) / totalFiles) * 75);
        sendProgress(`上传文件 ${i + 1}/${totalFiles}: ${file.path}`, percent);
      }
      
      sendProgress('上传完成！', 100);
      return { 
        success: true, 
        url: `https://github.com/${owner}/${repoName}`,
        filesCount: files.length
      };
    }

    sendProgress('正在创建文件树...', 20);

    // 创建blob并构建树
    const treeItems = [];
    const totalFiles = files.length;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const content = fs.readFileSync(file.fullPath);
      const base64Content = content.toString('base64');

      const { data: blob } = await octokit.rest.git.createBlob({
        owner,
        repo: repoName,
        content: base64Content,
        encoding: 'base64'
      });

      treeItems.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha
      });

      const percent = 20 + Math.floor((i / totalFiles) * 60);
      sendProgress(`上传文件 ${i + 1}/${totalFiles}: ${file.path}`, percent);
    }

    sendProgress('正在创建提交...', 85);

    // 创建树
    const treeParams = {
      owner,
      repo: repoName,
      tree: treeItems
    };
    if (baseTree) {
      treeParams.base_tree = baseTree;
    }

    const { data: tree } = await octokit.rest.git.createTree(treeParams);

    // 创建提交
    const commitParams = {
      owner,
      repo: repoName,
      message: commitMessage || `Upload from GitHub Uploader - ${new Date().toLocaleString()}`,
      tree: tree.sha
    };
    if (parentSha) {
      commitParams.parents = [parentSha];
    }

    const { data: commit } = await octokit.rest.git.createCommit(commitParams);

    sendProgress('正在更新分支引用...', 95);

    // 更新或创建分支引用
    try {
      await octokit.rest.git.updateRef({
        owner,
        repo: repoName,
        ref: `heads/${defaultBranch}`,
        sha: commit.sha
      });
    } catch (e) {
      await octokit.rest.git.createRef({
        owner,
        repo: repoName,
        ref: `refs/heads/${defaultBranch}`,
        sha: commit.sha
      });
    }

    sendProgress('上传完成！', 100);

    return { 
      success: true, 
      url: `https://github.com/${owner}/${repoName}`,
      filesCount: files.length
    };

  } catch (error) {
    console.error('Upload error:', error);
    return { success: false, error: error.message };
  }
});

// 打开外部链接
ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

// ============ OAuth Device Flow 认证 ============

// 发起 Device Flow 认证
ipcMain.handle('start-device-flow', async (event, clientId) => {
  try {
    const useClientId = clientId || GITHUB_CLIENT_ID;
    const response = await httpPost('https://github.com/login/device/code', {
      client_id: useClientId,
      scope: 'repo'
    });
    
    console.log('Device flow response:', response);
    
    // 检查是否有错误
    if (response.error) {
      return { success: false, error: response.error_description || response.error };
    }
    
    // 检查必要字段是否存在
    if (!response.user_code || !response.device_code || !response.verification_uri) {
      return { 
        success: false, 
        error: 'GitHub OAuth App 配置错误。请创建自己的 OAuth App 并启用 Device Flow，或使用 Token 登录。' 
      };
    }
    
    // 自动打开浏览器
    shell.openExternal(response.verification_uri);
    
    return {
      success: true,
      userCode: response.user_code,
      verificationUri: response.verification_uri,
      deviceCode: response.device_code,
      expiresIn: response.expires_in,
      interval: response.interval || 5
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 轮询检查授权状态
ipcMain.handle('poll-device-auth', async (event, { deviceCode, interval, clientId }) => {
  try {
    const useClientId = clientId || GITHUB_CLIENT_ID;
    const response = await httpPost('https://github.com/login/oauth/access_token', {
      client_id: useClientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    });
    
    if (response.error) {
      if (response.error === 'authorization_pending') {
        return { success: false, pending: true };
      } else if (response.error === 'slow_down') {
        return { success: false, pending: true, slowDown: true };
      } else if (response.error === 'expired_token') {
        return { success: false, error: '授权已过期，请重新登录' };
      } else if (response.error === 'access_denied') {
        return { success: false, error: '用户拒绝了授权' };
      }
      return { success: false, error: response.error_description || response.error };
    }
    
    if (response.access_token) {
      // 使用获取的token初始化octokit
      octokit = new Octokit({ auth: response.access_token });
      const { data } = await octokit.rest.users.getAuthenticated();
      currentUser = data;
      
      return {
        success: true,
        token: response.access_token,
        user: data
      };
    }
    
    return { success: false, error: '未知错误' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 取消轮询
ipcMain.on('cancel-device-flow', () => {
  if (deviceFlowPolling) {
    clearInterval(deviceFlowPolling);
    deviceFlowPolling = null;
  }
});

// HTTP POST 请求辅助函数
function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = new URLSearchParams(data).toString();
    
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          // 尝试解析 URL encoded 响应
          const params = new URLSearchParams(body);
          const result = {};
          params.forEach((value, key) => result[key] = value);
          resolve(result);
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}
