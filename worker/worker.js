// 包含完整前端页面的 HTML 模板字符串
// 注意：前端代码中的 `${}` 和反引号已被安全转义，以确保 Worker 能正确解析
const HTML_CONTENT = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>eSIM 资产与保号看板</title>
    <script src="https://cdn.tailwindcss.com"><\/script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        body {
            background: linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab);
            background-size: 400% 400%;
            animation: gradient 15s ease infinite;
            min-height: 100vh;
        }
        @keyframes gradient {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }
        .glass-panel {
            background: rgba(255, 255, 255, 0.25);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.4);
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.15);
        }
        .glass-card {
            background: rgba(255, 255, 255, 0.7);
            backdrop-filter: blur(8px);
            border: 1px solid rgba(255, 255, 255, 0.5);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .glass-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 12px 24px rgba(0,0,0,0.1);
        }
        .batch-mode .glass-card:hover {
            transform: none;
        }
        .modal-enter { opacity: 0; transform: scale(0.9); }
        .modal-enter-active { opacity: 1; transform: scale(1); transition: all 0.3s ease; }
        .sort-btn.active {
            background: rgba(59, 130, 246, 0.15);
            color: #1d4ed8;
            border-color: rgba(59, 130, 246, 0.4);
        }
        .batch-bar {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 40;
            transform: translateY(100%);
            transition: transform 0.3s ease;
        }
        .batch-bar.show {
            transform: translateY(0);
        }
        .card-checkbox {
            display: none;
        }
        .batch-mode .card-checkbox {
            display: flex;
        }
        .card-selected {
            ring: 2px;
            outline: 3px solid rgba(59, 130, 246, 0.5);
            outline-offset: -1px;
        }
        .flag-icon {
            width: 24px;
            height: 18px;
            object-fit: cover;
            border-radius: 3px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.15);
            vertical-align: middle;
            flex-shrink: 0;
        }
        .flag-icon-sm {
            width: 18px;
            height: 13px;
        }
        .flag-group {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            flex-shrink: 0;
        }
    </style>
</head>
<body class="text-gray-800 font-sans p-4 md:p-8 relative">

    <!-- 登录界面 (默认显示，未授权时拦截) -->
    <div id="login-container" class="max-w-md mx-auto glass-panel rounded-3xl p-8 md:p-10 mt-16 md:mt-32 text-center transition-all">
        <div class="w-20 h-20 bg-white/50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
            <i class="fa-solid fa-shield-halved text-4xl text-blue-600"></i>
        </div>
        <h2 class="text-3xl font-extrabold text-gray-900 mb-2">安全验证</h2>
        <p class="text-gray-600 mb-8 text-sm font-medium">为保护您的卡片资产，请获取验证码登录。</p>
        
        <div class="mb-6 relative">
            <input type="text" id="authCode" placeholder="输入 6 位数验证码" maxlength="6" class="w-full px-4 py-4 rounded-xl border border-gray-300/50 text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/70 shadow-inner placeholder-gray-400 placeholder:tracking-normal placeholder:text-base">
        </div>
        
        <div class="flex flex-col gap-4 mt-8">
            <button id="loginBtn" onclick="verifyCode()" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2">
                <i class="fa-solid fa-arrow-right-to-bracket"></i> 登录面板
            </button>
            <button id="sendCodeBtn" onclick="sendAuthCode()" class="w-full bg-white/60 hover:bg-white/80 text-blue-700 font-bold py-3.5 px-4 rounded-xl border border-blue-200/50 transition-colors flex items-center justify-center gap-2">
                <i class="fa-brands fa-telegram text-xl"></i> 向 TG 机器人获取验证码
            </button>
        </div>
    </div>

    <!-- 主界面容器 (默认隐藏，登录成功后显示) -->
    <div id="main-container" class="max-w-6xl mx-auto glass-panel rounded-3xl p-6 md:p-10 mt-4 md:mt-8 hidden">
        <!-- 头部信息 -->
        <div class="flex flex-col md:flex-row justify-between items-center mb-10 border-b border-white/50 pb-6 gap-4">
            <div>
                <h1 class="text-3xl md:text-4xl font-extrabold text-gray-900 tracking-tight flex items-center gap-3">
                    <i class="fa-solid fa-sim-card text-blue-600"></i>
                    eSIM 保号看板
                </h1>
                <p class="text-gray-700 mt-2 font-medium">自动监控卡片有效期，到期前触发 Telegram 提醒。</p>
            </div>
            <div class="flex gap-3 items-center flex-wrap justify-center">
                <span class="text-sm bg-white/50 px-4 py-2 rounded-full font-semibold shadow-sm hidden md:inline-block">
                    今日：<span id="current-date" class="text-blue-700">...</span>
                </span>
                <button onclick="openModal()" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-full font-bold shadow-lg transition-colors flex items-center gap-2">
                    <i class="fa-solid fa-plus"></i> 添加号码
                </button>
                <button onclick="toggleBatchMode()" id="batchModeBtn" class="bg-white/60 hover:bg-white/80 text-gray-700 px-4 py-2.5 rounded-full font-bold shadow-sm transition-colors flex items-center gap-2 border border-gray-200/50">
                    <i class="fa-solid fa-list-check"></i> <span class="hidden sm:inline">批量管理</span>
                </button>
                <button onclick="logout()" class="bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2.5 rounded-full font-bold shadow-sm transition-colors flex items-center gap-2 border border-red-200" title="退出登录">
                    <i class="fa-solid fa-right-from-bracket"></i>
                </button>
            </div>
        </div>

        <!-- 状态统计 -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6" id="stats-container">
            <!-- JS 动态注入 -->
        </div>

        <!-- 搜索与排序栏 -->
        <div class="flex flex-col sm:flex-row gap-3 mb-6 items-stretch sm:items-center">
            <!-- 搜索框 -->
            <div class="relative flex-1">
                <i class="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
                <input type="text" id="searchInput" placeholder="搜索名称或号码..." oninput="debouncedFilter()" class="w-full pl-11 pr-4 py-2.5 rounded-xl border border-gray-300/50 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/70 shadow-sm text-sm font-medium placeholder-gray-400">
            </div>
            <!-- 排序按钮组 -->
            <div class="flex gap-2 flex-shrink-0 flex-wrap">
                <button onclick="setSort('remainDays')" id="sort-remainDays" class="sort-btn active text-xs px-3 py-2 rounded-lg border border-gray-200/50 bg-white/50 font-semibold transition-all hover:bg-blue-50 flex items-center gap-1">
                    <i class="fa-solid fa-hourglass-half"></i> 剩余天数 <span class="sort-dir">↑</span>
                </button>
                <button onclick="setSort('name')" id="sort-name" class="sort-btn text-xs px-3 py-2 rounded-lg border border-gray-200/50 bg-white/50 font-semibold transition-all hover:bg-blue-50 flex items-center gap-1">
                    <i class="fa-solid fa-font"></i> 名称 <span class="sort-dir"></span>
                </button>
                <button onclick="setSort('addTime')" id="sort-addTime" class="sort-btn text-xs px-3 py-2 rounded-lg border border-gray-200/50 bg-white/50 font-semibold transition-all hover:bg-blue-50 flex items-center gap-1">
                    <i class="fa-solid fa-clock-rotate-left"></i> 添加时间 <span class="sort-dir"></span>
                </button>
            </div>
        </div>

        <!-- 卡片列表容器 -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" id="esim-container">
            <div class="col-span-full text-center py-10 text-gray-700 font-medium text-lg" id="loading-text">
                <i class="fa-solid fa-spinner fa-spin mr-2"></i> 正在读取数据...
            </div>
        </div>
    </div>

    <!-- 批量操作底部栏 -->
    <div id="batchBar" class="batch-bar">
        <div class="max-w-6xl mx-auto px-4 py-3">
            <div class="glass-panel rounded-2xl px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div class="flex items-center gap-4">
                    <label class="flex items-center gap-2 cursor-pointer text-sm font-semibold text-gray-700">
                        <input type="checkbox" id="selectAllCheckbox" onchange="toggleSelectAll(this.checked)" class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                        全选
                    </label>
                    <span class="text-sm text-gray-600 font-medium">已选 <span id="selectedCount" class="text-blue-600 font-bold">0</span> 项</span>
                </div>
                <div class="flex gap-3">
                    <button onclick="batchRenew()" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-xl font-bold shadow-md transition-colors flex items-center gap-2 text-sm">
                        <i class="fa-solid fa-rotate-right"></i> 批量续期
                    </button>
                    <button onclick="batchDelete()" class="bg-red-500 hover:bg-red-600 text-white px-5 py-2 rounded-xl font-bold shadow-md transition-colors flex items-center gap-2 text-sm">
                        <i class="fa-solid fa-trash-can"></i> 批量删除
                    </button>
                    <button onclick="toggleBatchMode()" class="bg-white/70 hover:bg-white text-gray-600 px-4 py-2 rounded-xl font-bold shadow-sm transition-colors flex items-center gap-2 text-sm border border-gray-200/60">
                        <i class="fa-solid fa-xmark"></i> 取消
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- 添加/编辑卡片模态框 -->
    <div id="addModal" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
        <!-- 增加了 max-h-screen 和 overflow-y-auto 以防止屏幕较小时内容被遮挡 -->
        <div class="glass-card w-full max-w-md rounded-2xl p-6 shadow-2xl relative transition-all duration-300 transform scale-95 opacity-0 max-h-[95vh] overflow-y-auto" id="modalContent">
            <button onclick="closeModal()" class="absolute top-4 right-4 text-gray-500 hover:text-red-500 text-xl">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <h3 class="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2" id="modalTitle">
                <i class="fa-solid fa-file-circle-plus text-blue-600"></i> 新增 eSIM
            </h3>
            
            <form id="addForm" onsubmit="submitForm(event)">
                <div class="mb-4">
                    <label class="block text-gray-700 text-sm font-bold mb-2">卡片名称 (必填)</label>
                    <input type="text" id="simName" required placeholder="例如：KnowRoaming" class="w-full px-4 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/80">
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 text-sm font-bold mb-2">手机号码带区号 (选填)</label>
                    <input type="text" id="simNumber" placeholder="例如：+1 234 567 8900" class="w-full px-4 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/80">
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 text-sm font-bold mb-2">开始日期 (必填)</label>
                    <input type="date" id="simStartDate" required class="w-full px-4 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/80" onchange="autoCalcExpireDate()">
                    <p class="text-xs text-gray-400 mt-1">默认为今天，可自行修改</p>
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 text-sm font-bold mb-2">保号周期 (必填)</label>
                    <div class="flex gap-2">
                        <input type="number" id="simCycle" required placeholder="例如：180" class="flex-1 px-4 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/80" oninput="autoCalcExpireDate()">
                        <select id="simCycleUnit" onchange="autoCalcExpireDate()" class="px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/80 font-semibold text-sm">
                            <option value="day">天</option>
                            <option value="month">月</option>
                            <option value="quarter">季度</option>
                            <option value="year">年</option>
                        </select>
                    </div>
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 text-sm font-bold mb-2">提前提醒天数 (选填)</label>
                    <input type="number" id="simReminderDays" placeholder="默认 15 天" class="w-full px-4 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/80">
                    <p class="text-xs text-gray-400 mt-1">到期前多少天开始通知，不填则默认 15 天</p>
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 text-sm font-bold mb-2">备注 / 保号要求 (选填)</label>
                    <input type="text" id="simRemark" placeholder="例如：发送短信到某号码 或 充值5元" class="w-full px-4 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/80">
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 text-sm font-bold mb-2">本次到期日 (必填)</label>
                    <input type="date" id="simExpire" required class="w-full px-4 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/80">
                    <p class="text-xs text-gray-400 mt-1" id="expireHint"></p>
                </div>
                <div class="mb-6 flex items-center justify-between bg-gradient-to-r from-blue-50/80 to-indigo-50/80 rounded-xl px-4 py-3.5 border border-blue-100/60">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-arrows-rotate text-blue-500"></i>
                        <div>
                            <span class="text-sm font-bold text-gray-700">到期后自动延期</span>
                            <p class="text-[11px] text-gray-400 mt-0.5">开启后，到期当天系统自动续延一个保号周期</p>
                        </div>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer flex-shrink-0 ml-3">
                        <input type="checkbox" id="simAutoRenew" class="sr-only peer">
                        <div class="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-400 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 shadow-inner"></div>
                    </label>
                </div>
                <button type="submit" id="submitBtn" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl shadow-md transition-colors">
                    保存并监控
                </button>
            </form>
        </div>
    </div>

    <!-- 续期模式选择模态框 -->
    <div id="renewModal" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
        <div class="glass-card w-full max-w-sm rounded-2xl p-6 shadow-2xl relative transition-all duration-300 transform scale-95 opacity-0" id="renewModalContent">
            <button onclick="closeRenewModal()" class="absolute top-4 right-4 text-gray-500 hover:text-red-500 text-xl">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <h3 class="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                <i class="fa-solid fa-rotate-right text-blue-600"></i> 选择续期方式
            </h3>
            <p class="text-sm text-gray-500 mb-5" id="renewSimInfo">卡片名称</p>

            <div class="space-y-3 mb-6">
                <!-- 基于到期日 -->
                <label class="block cursor-pointer group">
                    <input type="radio" name="renewMode" value="fromExpiry" checked class="sr-only peer">
                    <div class="peer-checked:border-blue-500 peer-checked:bg-blue-50/80 border-2 border-gray-200 rounded-xl p-4 transition-all hover:border-blue-300">
                        <div class="flex items-center justify-between mb-1">
                            <span class="font-bold text-gray-800 text-sm">基于到期日续延</span>
                            <span class="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">推荐</span>
                        </div>
                        <p class="text-xs text-gray-500">到期日 + 周期 = 新到期日，不浪费剩余天数</p>
                        <p class="text-xs text-blue-600 font-semibold mt-1.5" id="renewPreviewExpiry">新到期日：计算中...</p>
                    </div>
                </label>
                <!-- 基于今天 -->
                <label class="block cursor-pointer group">
                    <input type="radio" name="renewMode" value="fromToday" class="sr-only peer">
                    <div class="peer-checked:border-blue-500 peer-checked:bg-blue-50/80 border-2 border-gray-200 rounded-xl p-4 transition-all hover:border-blue-300">
                        <div class="flex items-center justify-between mb-1">
                            <span class="font-bold text-gray-800 text-sm">基于今天续延</span>
                        </div>
                        <p class="text-xs text-gray-500">今天 + 周期 = 新到期日</p>
                        <p class="text-xs text-blue-600 font-semibold mt-1.5" id="renewPreviewToday">新到期日：计算中...</p>
                    </div>
                </label>
            </div>

            <button onclick="confirmRenew()" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl shadow-md transition-colors flex items-center justify-center gap-2">
                <i class="fa-solid fa-check"></i> 确认续期
            </button>
        </div>
    </div>

    <script>
        // API 路由前缀
        const WORKER_API_URL = "/api/esims";
        let esimData = []; 
        let countdownInterval;
        let editingId = null; 
        let batchMode = false;
        let selectedIds = new Set();
        let currentSort = { key: 'remainDays', asc: true };
        let searchTimer = null;
        let renewTarget = null; // { id, cycle, cycleUnit, expireDate, name } - 当前续期目标

        // ================= 国旗字典配置（ISO 3166-1 alpha-2 国家代码）=================
        // 使用 flagcdn.com SVG 图片代替 emoji，彻底解决 Windows / 老旧安卓 / 部分浏览器上
        // 国旗 emoji 显示为字母代码（如 US、CN）的兼容性问题。
        // 涵盖 ~170 个国家和地区，含 NANP (+1xxx) 精确匹配。
        // 匹配算法按前缀长度降序排列，自动优先匹配最长区号。
        const countryFlags = [
            // ===== NANP +1 子区号（北美及加勒比海精确匹配）=====
            { prefix: "+1242", codes: ["bs"] },  // 巴哈马
            { prefix: "+1246", codes: ["bb"] },  // 巴巴多斯
            { prefix: "+1264", codes: ["ai"] },  // 安圭拉
            { prefix: "+1268", codes: ["ag"] },  // 安提瓜和巴布达
            { prefix: "+1284", codes: ["vg"] },  // 英属维尔京群岛
            { prefix: "+1340", codes: ["vi"] },  // 美属维尔京群岛
            { prefix: "+1345", codes: ["ky"] },  // 开曼群岛
            { prefix: "+1441", codes: ["bm"] },  // 百慕大
            { prefix: "+1473", codes: ["gd"] },  // 格林纳达
            { prefix: "+1649", codes: ["tc"] },  // 特克斯和凯科斯群岛
            { prefix: "+1658", codes: ["jm"] },  // 牙买加（备用区号）
            { prefix: "+1664", codes: ["ms"] },  // 蒙特塞拉特
            { prefix: "+1670", codes: ["mp"] },  // 北马里亚纳群岛
            { prefix: "+1671", codes: ["gu"] },  // 关岛
            { prefix: "+1684", codes: ["as"] },  // 美属萨摩亚
            { prefix: "+1721", codes: ["sx"] },  // 荷属圣马丁
            { prefix: "+1758", codes: ["lc"] },  // 圣卢西亚
            { prefix: "+1767", codes: ["dm"] },  // 多米尼克
            { prefix: "+1784", codes: ["vc"] },  // 圣文森特和格林纳丁斯
            { prefix: "+1787", codes: ["pr"] },  // 波多黎各
            { prefix: "+1809", codes: ["do"] },  // 多米尼加共和国
            { prefix: "+1829", codes: ["do"] },  // 多米尼加共和国（备用）
            { prefix: "+1849", codes: ["do"] },  // 多米尼加共和国（备用）
            { prefix: "+1868", codes: ["tt"] },  // 特立尼达和多巴哥
            { prefix: "+1869", codes: ["kn"] },  // 圣基茨和尼维斯
            { prefix: "+1876", codes: ["jm"] },  // 牙买加
            { prefix: "+1939", codes: ["pr"] },  // 波多黎各（备用）
            // ===== +1 通用回退 =====
            { prefix: "+1", codes: ["us", "ca"] },    // 美国/加拿大
            // ===== +7 子区号 =====
            { prefix: "+77", codes: ["kz"] },          // 哈萨克斯坦（+77xx）
            { prefix: "+7", codes: ["ru"] },            // 俄罗斯
            // ===== 亚洲 =====
            { prefix: "+86", codes: ["cn"] },    // 中国大陆
            { prefix: "+852", codes: ["hk"] },   // 中国香港
            { prefix: "+853", codes: ["mo"] },   // 中国澳门
            { prefix: "+886", codes: ["tw"] },   // 中国台湾
            { prefix: "+81", codes: ["jp"] },    // 日本
            { prefix: "+82", codes: ["kr"] },    // 韩国
            { prefix: "+850", codes: ["kp"] },   // 朝鲜
            { prefix: "+65", codes: ["sg"] },    // 新加坡
            { prefix: "+60", codes: ["my"] },    // 马来西亚
            { prefix: "+66", codes: ["th"] },    // 泰国
            { prefix: "+62", codes: ["id"] },    // 印度尼西亚
            { prefix: "+63", codes: ["ph"] },    // 菲律宾
            { prefix: "+84", codes: ["vn"] },    // 越南
            { prefix: "+91", codes: ["in"] },    // 印度
            { prefix: "+92", codes: ["pk"] },    // 巴基斯坦
            { prefix: "+93", codes: ["af"] },    // 阿富汗
            { prefix: "+94", codes: ["lk"] },    // 斯里兰卡
            { prefix: "+95", codes: ["mm"] },    // 缅甸
            { prefix: "+855", codes: ["kh"] },   // 柬埔寨
            { prefix: "+856", codes: ["la"] },   // 老挝
            { prefix: "+880", codes: ["bd"] },   // 孟加拉国
            { prefix: "+960", codes: ["mv"] },   // 马尔代夫
            { prefix: "+975", codes: ["bt"] },   // 不丹
            { prefix: "+976", codes: ["mn"] },   // 蒙古
            { prefix: "+977", codes: ["np"] },   // 尼泊尔
            { prefix: "+98", codes: ["ir"] },    // 伊朗
            { prefix: "+964", codes: ["iq"] },   // 伊拉克
            { prefix: "+962", codes: ["jo"] },   // 约旦
            { prefix: "+961", codes: ["lb"] },   // 黎巴嫩
            { prefix: "+963", codes: ["sy"] },   // 叙利亚
            { prefix: "+967", codes: ["ye"] },   // 也门
            { prefix: "+968", codes: ["om"] },   // 阿曼
            { prefix: "+970", codes: ["ps"] },   // 巴勒斯坦
            { prefix: "+971", codes: ["ae"] },   // 阿联酋
            { prefix: "+972", codes: ["il"] },   // 以色列
            { prefix: "+973", codes: ["bh"] },   // 巴林
            { prefix: "+974", codes: ["qa"] },   // 卡塔尔
            { prefix: "+966", codes: ["sa"] },   // 沙特阿拉伯
            { prefix: "+965", codes: ["kw"] },   // 科威特
            { prefix: "+994", codes: ["az"] },   // 阿塞拜疆
            { prefix: "+993", codes: ["tm"] },   // 土库曼斯坦
            { prefix: "+992", codes: ["tj"] },   // 塔吉克斯坦
            { prefix: "+998", codes: ["uz"] },   // 乌兹别克斯坦
            { prefix: "+996", codes: ["kg"] },   // 吉尔吉斯斯坦
            // ===== 大洋洲 =====
            { prefix: "+61", codes: ["au"] },    // 澳大利亚
            { prefix: "+64", codes: ["nz"] },    // 新西兰
            { prefix: "+675", codes: ["pg"] },   // 巴布亚新几内亚
            { prefix: "+679", codes: ["fj"] },   // 斐济
            { prefix: "+676", codes: ["to"] },   // 汤加
            { prefix: "+685", codes: ["ws"] },   // 萨摩亚
            { prefix: "+678", codes: ["vu"] },   // 瓦努阿图
            { prefix: "+677", codes: ["sb"] },   // 所罗门群岛
            { prefix: "+686", codes: ["ki"] },   // 基里巴斯
            { prefix: "+688", codes: ["tv"] },   // 图瓦卢
            { prefix: "+691", codes: ["fm"] },   // 密克罗尼西亚
            { prefix: "+692", codes: ["mh"] },   // 马绍尔群岛
            { prefix: "+680", codes: ["pw"] },   // 帕劳
            { prefix: "+682", codes: ["ck"] },   // 库克群岛
            { prefix: "+674", codes: ["nr"] },   // 瑙鲁
            { prefix: "+689", codes: ["pf"] },   // 法属波利尼西亚
            { prefix: "+687", codes: ["nc"] },   // 新喀里多尼亚
            // ===== 欧洲 =====
            { prefix: "+44", codes: ["gb"] },    // 英国
            { prefix: "+33", codes: ["fr"] },    // 法国
            { prefix: "+49", codes: ["de"] },    // 德国
            { prefix: "+39", codes: ["it"] },    // 意大利
            { prefix: "+34", codes: ["es"] },    // 西班牙
            { prefix: "+351", codes: ["pt"] },   // 葡萄牙
            { prefix: "+31", codes: ["nl"] },    // 荷兰
            { prefix: "+32", codes: ["be"] },    // 比利时
            { prefix: "+41", codes: ["ch"] },    // 瑞士
            { prefix: "+43", codes: ["at"] },    // 奥地利
            { prefix: "+46", codes: ["se"] },    // 瑞典
            { prefix: "+47", codes: ["no"] },    // 挪威
            { prefix: "+48", codes: ["pl"] },    // 波兰
            { prefix: "+45", codes: ["dk"] },    // 丹麦
            { prefix: "+358", codes: ["fi"] },   // 芬兰
            { prefix: "+30", codes: ["gr"] },    // 希腊
            { prefix: "+353", codes: ["ie"] },   // 爱尔兰
            { prefix: "+354", codes: ["is"] },   // 冰岛
            { prefix: "+352", codes: ["lu"] },   // 卢森堡
            { prefix: "+356", codes: ["mt"] },   // 马耳他
            { prefix: "+357", codes: ["cy"] },   // 塞浦路斯
            { prefix: "+36", codes: ["hu"] },    // 匈牙利
            { prefix: "+40", codes: ["ro"] },    // 罗马尼亚
            { prefix: "+359", codes: ["bg"] },   // 保加利亚
            { prefix: "+420", codes: ["cz"] },   // 捷克
            { prefix: "+421", codes: ["sk"] },   // 斯洛伐克
            { prefix: "+386", codes: ["si"] },   // 斯洛文尼亚
            { prefix: "+385", codes: ["hr"] },   // 克罗地亚
            { prefix: "+387", codes: ["ba"] },   // 波黑
            { prefix: "+381", codes: ["rs"] },   // 塞尔维亚
            { prefix: "+382", codes: ["me"] },   // 黑山
            { prefix: "+383", codes: ["xk"] },   // 科索沃
            { prefix: "+389", codes: ["mk"] },   // 北马其顿
            { prefix: "+355", codes: ["al"] },   // 阿尔巴尼亚
            { prefix: "+370", codes: ["lt"] },   // 立陶宛
            { prefix: "+371", codes: ["lv"] },   // 拉脱维亚
            { prefix: "+372", codes: ["ee"] },   // 爱沙尼亚
            { prefix: "+373", codes: ["md"] },   // 摩尔多瓦
            { prefix: "+374", codes: ["am"] },   // 亚美尼亚
            { prefix: "+375", codes: ["by"] },   // 白俄罗斯
            { prefix: "+380", codes: ["ua"] },   // 乌克兰
            { prefix: "+995", codes: ["ge"] },   // 格鲁吉亚
            { prefix: "+90", codes: ["tr"] },    // 土耳其
            { prefix: "+377", codes: ["mc"] },   // 摩纳哥
            { prefix: "+378", codes: ["sm"] },   // 圣马力诺
            { prefix: "+376", codes: ["ad"] },   // 安道尔
            { prefix: "+423", codes: ["li"] },   // 列支敦士登
            // ===== 非洲 =====
            { prefix: "+20", codes: ["eg"] },    // 埃及
            { prefix: "+27", codes: ["za"] },    // 南非
            { prefix: "+212", codes: ["ma"] },   // 摩洛哥
            { prefix: "+213", codes: ["dz"] },   // 阿尔及利亚
            { prefix: "+216", codes: ["tn"] },   // 突尼斯
            { prefix: "+218", codes: ["ly"] },   // 利比亚
            { prefix: "+220", codes: ["gm"] },   // 冈比亚
            { prefix: "+221", codes: ["sn"] },   // 塞内加尔
            { prefix: "+222", codes: ["mr"] },   // 毛里塔尼亚
            { prefix: "+223", codes: ["ml"] },   // 马里
            { prefix: "+224", codes: ["gn"] },   // 几内亚
            { prefix: "+225", codes: ["ci"] },   // 科特迪瓦
            { prefix: "+226", codes: ["bf"] },   // 布基纳法索
            { prefix: "+227", codes: ["ne"] },   // 尼日尔
            { prefix: "+228", codes: ["tg"] },   // 多哥
            { prefix: "+229", codes: ["bj"] },   // 贝宁
            { prefix: "+230", codes: ["mu"] },   // 毛里求斯
            { prefix: "+231", codes: ["lr"] },   // 利比里亚
            { prefix: "+232", codes: ["sl"] },   // 塞拉利昂
            { prefix: "+233", codes: ["gh"] },   // 加纳
            { prefix: "+234", codes: ["ng"] },   // 尼日利亚
            { prefix: "+235", codes: ["td"] },   // 乍得
            { prefix: "+236", codes: ["cf"] },   // 中非共和国
            { prefix: "+237", codes: ["cm"] },   // 喀麦隆
            { prefix: "+238", codes: ["cv"] },   // 佛得角
            { prefix: "+239", codes: ["st"] },   // 圣多美和普林西比
            { prefix: "+240", codes: ["gq"] },   // 赤道几内亚
            { prefix: "+241", codes: ["ga"] },   // 加蓬
            { prefix: "+242", codes: ["cg"] },   // 刚果（布）
            { prefix: "+243", codes: ["cd"] },   // 刚果（金）
            { prefix: "+244", codes: ["ao"] },   // 安哥拉
            { prefix: "+245", codes: ["gw"] },   // 几内亚比绍
            { prefix: "+248", codes: ["sc"] },   // 塞舌尔
            { prefix: "+249", codes: ["sd"] },   // 苏丹
            { prefix: "+250", codes: ["rw"] },   // 卢旺达
            { prefix: "+251", codes: ["et"] },   // 埃塞俄比亚
            { prefix: "+252", codes: ["so"] },   // 索马里
            { prefix: "+253", codes: ["dj"] },   // 吉布提
            { prefix: "+254", codes: ["ke"] },   // 肯尼亚
            { prefix: "+255", codes: ["tz"] },   // 坦桑尼亚
            { prefix: "+256", codes: ["ug"] },   // 乌干达
            { prefix: "+257", codes: ["bi"] },   // 布隆迪
            { prefix: "+258", codes: ["mz"] },   // 莫桑比克
            { prefix: "+260", codes: ["zm"] },   // 赞比亚
            { prefix: "+261", codes: ["mg"] },   // 马达加斯加
            { prefix: "+262", codes: ["re"] },   // 留尼汪
            { prefix: "+263", codes: ["zw"] },   // 津巴布韦
            { prefix: "+264", codes: ["na"] },   // 纳米比亚
            { prefix: "+265", codes: ["mw"] },   // 马拉维
            { prefix: "+266", codes: ["ls"] },   // 莱索托
            { prefix: "+267", codes: ["bw"] },   // 博茨瓦纳
            { prefix: "+268", codes: ["sz"] },   // 斯威士兰
            { prefix: "+269", codes: ["km"] },   // 科摩罗
            { prefix: "+211", codes: ["ss"] },   // 南苏丹
            { prefix: "+291", codes: ["er"] },   // 厄立特里亚
            { prefix: "+297", codes: ["aw"] },   // 阿鲁巴
            // ===== 美洲（非 NANP）=====
            { prefix: "+52", codes: ["mx"] },    // 墨西哥
            { prefix: "+53", codes: ["cu"] },    // 古巴
            { prefix: "+54", codes: ["ar"] },    // 阿根廷
            { prefix: "+55", codes: ["br"] },    // 巴西
            { prefix: "+56", codes: ["cl"] },    // 智利
            { prefix: "+57", codes: ["co"] },    // 哥伦比亚
            { prefix: "+58", codes: ["ve"] },    // 委内瑞拉
            { prefix: "+51", codes: ["pe"] },    // 秘鲁
            { prefix: "+502", codes: ["gt"] },   // 危地马拉
            { prefix: "+503", codes: ["sv"] },   // 萨尔瓦多
            { prefix: "+504", codes: ["hn"] },   // 洪都拉斯
            { prefix: "+505", codes: ["ni"] },   // 尼加拉瓜
            { prefix: "+506", codes: ["cr"] },   // 哥斯达黎加
            { prefix: "+507", codes: ["pa"] },   // 巴拿马
            { prefix: "+509", codes: ["ht"] },   // 海地
            { prefix: "+591", codes: ["bo"] },   // 玻利维亚
            { prefix: "+592", codes: ["gy"] },   // 圭亚那
            { prefix: "+593", codes: ["ec"] },   // 厄瓜多尔
            { prefix: "+595", codes: ["py"] },   // 巴拉圭
            { prefix: "+597", codes: ["sr"] },   // 苏里南
            { prefix: "+598", codes: ["uy"] },   // 乌拉圭
            { prefix: "+599", codes: ["cw"] },   // 库拉索
            { prefix: "+500", codes: ["fk"] },   // 福克兰群岛
            { prefix: "+501", codes: ["bz"] },   // 伯利兹
            { prefix: "+594", codes: ["gf"] },   // 法属圭亚那
            { prefix: "+596", codes: ["mq"] },   // 马提尼克
            { prefix: "+590", codes: ["gp"] },   // 瓜德罗普
            // ===== 补充非洲/领地 =====
            { prefix: "+246", codes: ["io"] },   // 英属印度洋领地
            { prefix: "+247", codes: ["sh"] },   // 阿森松岛
            { prefix: "+290", codes: ["sh"] },   // 圣赫勒拿
            { prefix: "+298", codes: ["fo"] },   // 法罗群岛
            { prefix: "+299", codes: ["gl"] },   // 格陵兰
            // ===== 补充欧洲领地 =====
            { prefix: "+350", codes: ["gi"] },   // 直布罗陀
            { prefix: "+379", codes: ["va"] },   // 梵蒂冈
            // ===== 补充亚洲 =====
            { prefix: "+670", codes: ["tl"] },   // 东帝汶
            { prefix: "+672", codes: ["nf"] },   // 诺福克岛
            { prefix: "+673", codes: ["bn"] },   // 文莱
            // ===== 补充太平洋 =====
            { prefix: "+681", codes: ["wf"] },   // 瓦利斯和富图纳
            { prefix: "+683", codes: ["nu"] },   // 纽埃
            { prefix: "+690", codes: ["tk"] },   // 托克劳
            // ===== 补充中美 =====
            { prefix: "+508", codes: ["pm"] }    // 圣皮埃尔和密克隆
        ];

        // 预排序一次（按前缀长度降序），优先匹配最长区号（如 +1242 优先于 +1）
        const sortedCountryFlags = [...countryFlags].sort((a, b) => b.prefix.length - a.prefix.length);

        // 根据 ISO 国家代码生成 flagcdn.com 的 SVG 旗帜 <img> 标签
        // 彻底解决 Windows / 安卓 / 老旧浏览器上 emoji 旗帜显示为字母的问题
        function buildFlagImg(code, extraClass) {
            const cls = 'flag-icon' + (extraClass ? ' ' + extraClass : '');
            return '<img src="https://flagcdn.com/' + code + '.svg" alt="' + code.toUpperCase() + '" class="' + cls + '" loading="lazy" onerror="this.style.display=\\\'none\\\'">';
        }

        function getCountryFlag(numberStr) {
            if (!numberStr) return '<i class="fa-solid fa-phone text-gray-400"><\/i>';
            const cleanNumber = numberStr.replace(/[\\s\\-\\(\\)\\.]/g, '');
            if (!cleanNumber.startsWith('+')) return '<i class="fa-solid fa-globe text-gray-400"><\/i>';
            
            for (let item of sortedCountryFlags) {
                if (cleanNumber.startsWith(item.prefix)) {
                    if (item.codes.length === 1) {
                        return buildFlagImg(item.codes[0]);
                    }
                    // 多国共享区号（如 +1 美国/加拿大）：显示多面小旗帜
                    return '<span class="flag-group">' + item.codes.map(c => buildFlagImg(c, 'flag-icon-sm')).join('') + '<\/span>';
                }
            }
            return '<i class="fa-solid fa-globe text-gray-400"><\/i>';
        }

        // ================= XSS 防护 =================
        function escapeHTML(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        }

        // ================= 周期计算工具函数 =================
        function getCycleUnitLabel(unit) {
            const labels = { day: '天', month: '个月', quarter: '季度', year: '年' };
            return labels[unit] || '天';
        }

        function addCycleToDate(baseDate, cycle, cycleUnit) {
            const d = new Date(baseDate.getTime());
            const c = parseInt(cycle);
            switch (cycleUnit) {
                case 'month':
                    d.setMonth(d.getMonth() + c);
                    break;
                case 'quarter':
                    d.setMonth(d.getMonth() + c * 3);
                    break;
                case 'year':
                    d.setFullYear(d.getFullYear() + c);
                    break;
                case 'day':
                default:
                    d.setDate(d.getDate() + c);
                    break;
            }
            return d;
        }

        function formatDateStr(d) {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return yyyy + '-' + mm + '-' + dd;
        }

        document.getElementById('current-date').innerText = new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        
        window.onload = () => {
            if (sessionStorage.getItem('esim_auth_token')) {
                fetchEsimData();
            }
        };

        function getAuthHeaders() {
            return {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (sessionStorage.getItem('esim_auth_token') || '')
            };
        }

        // ================= 安全验证相关功能 =================
        async function sendAuthCode() {
            const btn = document.getElementById('sendCodeBtn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"><\/i> 发送中...';
            
            try {
                const response = await fetch('/api/auth/send', { method: 'POST' });
                const data = await response.json();
                
                if (response.ok && data.success) {
                    let timeLeft = 60;
                    btn.innerHTML = \`<i class="fa-solid fa-clock mr-2"><\/i> \${timeLeft} 秒后可重发\`;
                    countdownInterval = setInterval(() => {
                        timeLeft--;
                        if (timeLeft <= 0) {
                            clearInterval(countdownInterval);
                            btn.disabled = false;
                            btn.innerHTML = '<i class="fa-brands fa-telegram text-xl mr-2"><\/i> 向 TG 机器人获取验证码';
                        } else {
                            btn.innerHTML = \`<i class="fa-solid fa-clock mr-2"><\/i> \${timeLeft} 秒后可重发\`;
                        }
                    }, 1000);
                } else {
                    alert("发送失败: " + (data.message || "后端未配置机器人信息"));
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-brands fa-telegram text-xl mr-2"><\/i> 向 TG 机器人获取验证码';
                }
            } catch (e) {
                alert("网络错误，发送失败");
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-brands fa-telegram text-xl mr-2"><\/i> 向 TG 机器人获取验证码';
            }
        }

        async function verifyCode() {
            const codeInput = document.getElementById('authCode').value.trim();
            if (!codeInput || codeInput.length !== 6) return alert("请输入完整的 6 位数字验证码");
            
            const btn = document.getElementById('loginBtn');
            const originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"><\/i> 验证中...';
            
            try {
                const response = await fetch('/api/auth/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: codeInput })
                });
                const data = await response.json();
                
                if (response.ok && data.success) {
                    sessionStorage.setItem('esim_auth_token', data.token);
                    document.getElementById('authCode').value = '';
                    fetchEsimData();
                } else {
                    alert("登录失败: " + (data.message || "验证码错误或已过期"));
                    btn.disabled = false;
                    btn.innerHTML = originalHTML;
                }
            } catch (e) {
                alert("网络错误，验证失败");
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        function logout() {
            sessionStorage.removeItem('esim_auth_token');
            document.getElementById('login-container').classList.remove('hidden');
            document.getElementById('main-container').classList.add('hidden');
        }

        // ================= 搜索与排序 =================
        function debouncedFilter() {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                filterAndRender();
            }, 300);
        }

        function filterAndRender() {
            const query = (document.getElementById('searchInput').value || '').trim().toLowerCase();
            let filtered = esimData;
            if (query) {
                filtered = esimData.filter(sim => {
                    const name = (sim.name || '').toLowerCase();
                    const number = (sim.number || '').toLowerCase();
                    return name.includes(query) || number.includes(query);
                });
            }
            renderCards(filtered);
        }

        function setSort(key) {
            if (currentSort.key === key) {
                currentSort.asc = !currentSort.asc;
            } else {
                currentSort.key = key;
                currentSort.asc = true;
            }
            // 更新按钮 UI
            document.querySelectorAll('.sort-btn').forEach(btn => {
                btn.classList.remove('active');
                btn.querySelector('.sort-dir').textContent = '';
            });
            const activeBtn = document.getElementById('sort-' + key);
            if (activeBtn) {
                activeBtn.classList.add('active');
                activeBtn.querySelector('.sort-dir').textContent = currentSort.asc ? '↑' : '↓';
            }
            filterAndRender();
        }

        function sortEsims(esims) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const sorted = [...esims];
            sorted.sort((a, b) => {
                let cmp = 0;
                switch (currentSort.key) {
                    case 'remainDays': {
                        const dA = new Date(a.expireDate); dA.setHours(0,0,0,0);
                        const dB = new Date(b.expireDate); dB.setHours(0,0,0,0);
                        cmp = (dA - today) - (dB - today);
                        break;
                    }
                    case 'name':
                        cmp = (a.name || '').localeCompare(b.name || '', 'zh-CN');
                        break;
                    case 'addTime':
                        cmp = (a.id || '').localeCompare(b.id || '');
                        break;
                }
                return currentSort.asc ? cmp : -cmp;
            });
            return sorted;
        }

        // ================= 批量管理 =================
        function toggleBatchMode() {
            batchMode = !batchMode;
            selectedIds.clear();
            const container = document.getElementById('main-container');
            const bar = document.getElementById('batchBar');
            const btn = document.getElementById('batchModeBtn');
            
            if (batchMode) {
                container.classList.add('batch-mode');
                bar.classList.add('show');
                btn.classList.add('bg-blue-100', 'border-blue-300', 'text-blue-700');
                btn.classList.remove('bg-white/60', 'text-gray-700', 'border-gray-200/50');
            } else {
                container.classList.remove('batch-mode');
                bar.classList.remove('show');
                btn.classList.remove('bg-blue-100', 'border-blue-300', 'text-blue-700');
                btn.classList.add('bg-white/60', 'text-gray-700', 'border-gray-200/50');
            }
            updateSelectedCount();
            // 重新渲染以显示/隐藏复选框
            filterAndRender();
        }

        function toggleCardSelection(id, checkbox) {
            if (checkbox.checked) {
                selectedIds.add(id);
            } else {
                selectedIds.delete(id);
            }
            // 更新卡片样式
            const card = checkbox.closest('.glass-card');
            if (card) {
                card.classList.toggle('card-selected', checkbox.checked);
            }
            updateSelectedCount();
        }

        function toggleSelectAll(checked) {
            // 获取当前显示的卡片
            const query = (document.getElementById('searchInput').value || '').trim().toLowerCase();
            let filtered = esimData;
            if (query) {
                filtered = esimData.filter(sim => {
                    const name = (sim.name || '').toLowerCase();
                    const number = (sim.number || '').toLowerCase();
                    return name.includes(query) || number.includes(query);
                });
            }
            if (checked) {
                filtered.forEach(sim => selectedIds.add(sim.id));
            } else {
                selectedIds.clear();
            }
            // 更新所有复选框
            document.querySelectorAll('.card-select-input').forEach(cb => {
                cb.checked = checked;
                const card = cb.closest('.glass-card');
                if (card) card.classList.toggle('card-selected', checked);
            });
            updateSelectedCount();
        }

        function updateSelectedCount() {
            const el = document.getElementById('selectedCount');
            if (el) el.textContent = selectedIds.size;
            const selectAll = document.getElementById('selectAllCheckbox');
            if (selectAll) {
                selectAll.checked = selectedIds.size > 0 && selectedIds.size === document.querySelectorAll('.card-select-input').length;
            }
        }

        async function batchRenew() {
            if (selectedIds.size === 0) return alert('请先选择要续期的卡片');
            
            // 检查所有选中卡片是否都有周期
            const selected = esimData.filter(s => selectedIds.has(s.id));
            const noCycle = selected.filter(s => !s.cycle || s.cycle <= 0);
            if (noCycle.length > 0) {
                alert('以下卡片未设置保号周期，无法批量续期：\\n' + noCycle.map(s => s.name).join('、'));
                return;
            }

            // 弹窗选择续期模式
            const mode = await showBatchRenewDialog(selected);
            if (!mode) return;

            const updates = selected.map(sim => {
                const cycleUnit = sim.cycleUnit || 'day';
                let baseDate;
                if (mode === 'fromExpiry') {
                    const parts = sim.expireDate.split('-');
                    baseDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                } else {
                    baseDate = new Date();
                }
                baseDate.setHours(0, 0, 0, 0);
                const newDate = addCycleToDate(baseDate, sim.cycle, cycleUnit);
                return { id: sim.id, expireDate: formatDateStr(newDate) };
            });

            try {
                const response = await fetch(WORKER_API_URL + '/batch', {
                    method: 'PUT',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ updates })
                });
                if (response.status === 401) { logout(); return; }
                if (response.ok) {
                    selectedIds.clear();
                    updateSelectedCount();
                    await fetchEsimData();
                } else {
                    alert('批量续期失败');
                }
            } catch (e) {
                alert('网络错误，批量续期失败');
            }
        }

        function showBatchRenewDialog(selected) {
            return new Promise((resolve) => {
                const msg = \`选中 \${selected.length} 张卡片，请选择续期方式：\\n\\n1. 基于到期日（推荐）：到期日 + 周期\\n2. 基于今天：今天 + 周期\`;
                const choice = prompt(msg + '\\n\\n请输入 1 或 2：', '1');
                if (choice === '1') resolve('fromExpiry');
                else if (choice === '2') resolve('fromToday');
                else resolve(null);
            });
        }

        async function batchDelete() {
            if (selectedIds.size === 0) return alert('请先选择要删除的卡片');
            if (!confirm(\`确定要删除选中的 \${selectedIds.size} 张卡片吗？此操作不可撤销！\`)) return;

            try {
                const response = await fetch(WORKER_API_URL + '/batch', {
                    method: 'DELETE',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ ids: [...selectedIds] })
                });
                if (response.status === 401) { logout(); return; }
                if (response.ok) {
                    selectedIds.clear();
                    updateSelectedCount();
                    await fetchEsimData();
                } else {
                    alert('批量删除失败');
                }
            } catch (e) {
                alert('网络错误，批量删除失败');
            }
        }

        // ================= 核心业务相关功能 =================
        async function fetchEsimData() {
            const container = document.getElementById('esim-container');
            container.innerHTML = \`<div class="col-span-full text-center py-10 text-gray-700 font-medium text-lg"><i class="fa-solid fa-spinner fa-spin mr-2"><\/i> 正在加载数据...</div>\`;
            
            try {
                const response = await fetch(WORKER_API_URL, { headers: getAuthHeaders() });
                
                if (response.status === 401) {
                    logout();
                    return;
                }

                if (!response.ok) throw new Error("网络请求失败");
                
                esimData = await response.json();
                
                document.getElementById('login-container').classList.add('hidden');
                document.getElementById('main-container').classList.remove('hidden');
                
                filterAndRender();
            } catch (error) {
                console.error("加载失败:", error);
                container.innerHTML = \`
                    <div class="col-span-full text-center py-10">
                        <i class="fa-solid fa-triangle-exclamation text-4xl text-red-500 mb-3"><\/i>
                        <h3 class="text-xl font-bold text-gray-800">获取数据失败</h3>
                        <p class="text-gray-600 mt-2">网络异常，请重试。</p>
                    </div>\`;
            }
        }

        function renderCards(esims) {
            const container = document.getElementById('esim-container');
            const statsContainer = document.getElementById('stats-container');

            let safeCount = 0;
            let warningCount = 0;
            let dangerCount = 0;
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if(esims.length === 0) {
                container.innerHTML = \`<div class="col-span-full text-center py-16 text-gray-500"><i class="fa-solid fa-box-open text-4xl mb-3"><\/i><p>没有匹配的号码记录</p></div>\`;
                return;
            }

            // 排序
            const sorted = sortEsims(esims);

            // 【BUG FIX】使用数组拼接后一次性赋值，避免 innerHTML += 导致的重复解析
            const cardHTMLs = [];

            sorted.forEach(sim => {
                const expDate = new Date(sim.expireDate);
                expDate.setHours(0, 0, 0, 0);
                const diffTime = expDate - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                const reminderDays = sim.reminderDays || 15;
                
                let statusColor = "bg-green-500";
                let statusText = "状态安全";
                let badgeClass = "bg-green-100 text-green-800";
                let icon = "fa-check-circle text-green-500";

                if (diffDays <= 0) {
                    statusColor = "bg-gray-500";
                    statusText = diffDays === 0 ? "今日到期" : "已过期";
                    badgeClass = "bg-gray-100 text-gray-800";
                    icon = "fa-times-circle text-gray-500";
                    dangerCount++;
                } else if (diffDays <= reminderDays) {
                    statusColor = "bg-red-500";
                    statusText = "即将过期";
                    badgeClass = "bg-red-100 text-red-800";
                    icon = "fa-triangle-exclamation text-red-500";
                    dangerCount++;
                } else if (diffDays <= reminderDays * 3) {
                    statusColor = "bg-yellow-400";
                    statusText = "建议关注";
                    badgeClass = "bg-yellow-100 text-yellow-800";
                    icon = "fa-bell text-yellow-500";
                    warningCount++;
                } else {
                    safeCount++;
                }

                let percent = Math.min(Math.max((diffDays / 365) * 100, 0), 100);
                const flagEmoji = getCountryFlag(sim.number);
                
                // 渲染备注区域
                const remarkHTML = sim.remark ? \`<div class="bg-blue-50/60 rounded-lg p-2.5 mb-4 text-xs text-gray-700 border border-blue-100/60 break-words leading-relaxed"><i class="fa-regular fa-comment-dots mr-1.5 text-blue-400"><\/i>\${escapeHTML(sim.remark)}</div>\` : '';

                // 自动延期标签
                const autoRenewBadge = sim.autoRenew ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 whitespace-nowrap flex-shrink-0"><i class="fa-solid fa-arrows-rotate mr-0.5"><\/i>自动延期<\/span>' : '';

                // 周期显示
                const cycleUnit = sim.cycleUnit || 'day';
                const cycleLabel = sim.cycle ? (sim.cycle + ' ' + getCycleUnitLabel(cycleUnit)) : '-';

                // 提醒天数标签
                const reminderLabel = reminderDays !== 15 ? \`<span class="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold border border-amber-100/60">提前\${reminderDays}天提醒<\/span>\` : '';

                // 批量模式复选框
                const isSelected = selectedIds.has(sim.id);
                const checkboxHTML = \`<div class="card-checkbox absolute top-4 left-4 z-20">
                    <input type="checkbox" class="card-select-input w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" \${isSelected ? 'checked' : ''} onchange="toggleCardSelection('\${sim.id}', this)">
                </div>\`;

                const cardHTML = \`
                    <div class="glass-card rounded-2xl p-6 relative overflow-hidden group flex flex-col h-full \${isSelected ? 'card-selected' : ''}" data-id="\${sim.id}">
                        \${checkboxHTML}
                        
                        <!-- 操作按钮组 -->
                        <div class="absolute top-4 right-4 flex gap-1.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-all duration-300 z-20 bg-white/80 p-1.5 rounded-full backdrop-blur-md border border-white/60 shadow-sm">
                            <button onclick="openEditModal('\${sim.id}')" class="text-green-600 hover:text-white hover:bg-green-500 bg-white w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-sm" title="编辑卡片资料">
                                <i class="fa-solid fa-pen text-sm"><\/i>
                            </button>
                            <button onclick="openRenewModal('\${sim.id}')" class="text-blue-600 hover:text-white hover:bg-blue-500 bg-white w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-sm" title="续期">
                                <i class="fa-solid fa-rotate-right text-sm"><\/i>
                            </button>
                            <button onclick="deleteEsim('\${sim.id}')" class="text-red-500 hover:text-white hover:bg-red-500 bg-white w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-sm" title="删除号码">
                                <i class="fa-solid fa-trash-can text-sm"><\/i>
                            </button>
                        </div>

                        <!-- 标题区域 -->
                        <div class="pr-28 mb-3 \${batchMode ? 'pl-8' : ''}">
                            <h2 class="text-xl font-bold text-gray-900 truncate" title="\${escapeHTML(sim.name)}">\${escapeHTML(sim.name)}</h2>
                        </div>
                        
                        <!-- 号码与状态区域 -->
                        <div class="flex justify-between items-center mb-4 gap-2">
                            <p class="text-gray-600 font-mono text-sm flex items-center gap-1.5 truncate">
                                \${flagEmoji}
                                <span class="truncate">\${escapeHTML(sim.number || '未登记号码')}</span>
                            </p>
                            <!-- 状态标签 -->
                            <div class="flex items-center gap-1.5 flex-shrink-0">
                                \${autoRenewBadge}
                                \${reminderLabel}
                                <span class="px-2.5 py-1 rounded-full text-[11px] font-bold shadow-sm whitespace-nowrap flex-shrink-0 \${badgeClass}">
                                    <i class="fa-solid \${icon} mr-1"><\/i>\${statusText}
                                </span>
                            </div>
                        </div>
                        
                        <!-- 备注/保号要求区域 -->
                        \${remarkHTML}
                        
                        <!-- 底部进度条区域 -->
                        <div class="mt-auto">
                            <div class="flex justify-between text-sm font-semibold mb-2">
                                <span class="text-gray-700">剩余时间</span>
                                <span class="text-gray-900 font-bold \${diffDays <= reminderDays && diffDays > 0 ? 'text-red-600 animate-pulse' : ''}">\${diffDays < 0 ? '0' : diffDays} 天</span>
                            </div>
                            <div class="w-full bg-gray-200/60 rounded-full h-3 mb-2 shadow-inner">
                                <div class="\${statusColor} h-3 rounded-full shadow-sm transition-all duration-1000" style="width: \${percent}%"><\/div>
                            </div>
                            <div class="flex justify-between text-xs text-gray-500 mt-2 font-medium">
                                <span><i class="fa-solid fa-arrows-rotate mr-1"><\/i>周期: \${cycleLabel}</span>
                                <span>到期日: \${sim.expireDate}</span>
                            </div>
                        </div>
                    </div>
                \`;
                cardHTMLs.push(cardHTML);
            });

            container.innerHTML = cardHTMLs.join('');

            // 统计区域（基于全部数据，而非过滤后的）
            statsContainer.innerHTML = \`
                <div class="glass-card rounded-2xl p-5 flex items-center justify-between border-l-4 border-l-green-500">
                    <div>
                        <p class="text-gray-500 text-sm font-bold uppercase">安全卡片</p>
                        <p class="text-3xl font-black text-gray-800 mt-1">\${safeCount}</p>
                    </div>
                    <i class="fa-solid fa-shield-check text-4xl text-green-200"><\/i>
                </div>
                <div class="glass-card rounded-2xl p-5 flex items-center justify-between border-l-4 border-l-yellow-400">
                    <div>
                        <p class="text-gray-500 text-sm font-bold uppercase">建议关注</p>
                        <p class="text-3xl font-black text-gray-800 mt-1">\${warningCount}</p>
                    </div>
                    <i class="fa-solid fa-clock text-4xl text-yellow-200"><\/i>
                </div>
                <div class="glass-card rounded-2xl p-5 flex items-center justify-between border-l-4 border-l-red-500">
                    <div>
                        <p class="text-gray-500 text-sm font-bold uppercase">告警/过期</p>
                        <p class="text-3xl font-black text-gray-800 mt-1">\${dangerCount}</p>
                    </div>
                    <i class="fa-solid fa-siren-on text-4xl text-red-200"><\/i>
                </div>
            \`;
        }

        async function submitForm(e) {
            e.preventDefault();
            const btn = document.getElementById('submitBtn');
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"><\/i>保存中...';
            btn.disabled = true;

            const payload = {
                name: document.getElementById('simName').value,
                number: document.getElementById('simNumber').value,
                startDate: document.getElementById('simStartDate').value,
                cycle: parseInt(document.getElementById('simCycle').value) || 0,
                cycleUnit: document.getElementById('simCycleUnit').value,
                reminderDays: parseInt(document.getElementById('simReminderDays').value) || 15,
                remark: document.getElementById('simRemark').value,
                expireDate: document.getElementById('simExpire').value,
                autoRenew: document.getElementById('simAutoRenew').checked
            };

            if (editingId) {
                payload.id = editingId;
            }

            try {
                const response = await fetch(WORKER_API_URL, {
                    method: editingId ? 'PUT' : 'POST', 
                    headers: getAuthHeaders(),
                    body: JSON.stringify(payload)
                });
                
                if (response.status === 401) { logout(); return; }
                if (response.ok) {
                    closeModal();
                    await fetchEsimData(); 
                } else {
                    alert("保存失败，请检查数据。");
                }
            } catch (error) {
                alert("网络错误，保存失败。");
            } finally {
                btn.innerHTML = '保存并监控';
                btn.disabled = false;
            }
        }

        // ================= 续期模态框 =================
        function openRenewModal(id) {
            const sim = esimData.find(s => s.id === id);
            if (!sim) return;

            if (!sim.cycle || sim.cycle <= 0) {
                alert("该卡片未设置保号周期，无法自动计算日期。请直接点击编辑修改。");
                return;
            }

            renewTarget = {
                id: sim.id,
                cycle: sim.cycle,
                cycleUnit: sim.cycleUnit || 'day',
                expireDate: sim.expireDate,
                name: sim.name
            };

            // 计算两种模式的预览日期
            const cycleUnit = sim.cycleUnit || 'day';
            const unitLabel = getCycleUnitLabel(cycleUnit);

            // 基于到期日
            const expParts = sim.expireDate.split('-');
            const expBase = new Date(parseInt(expParts[0]), parseInt(expParts[1]) - 1, parseInt(expParts[2]));
            const fromExpiryDate = addCycleToDate(expBase, sim.cycle, cycleUnit);

            // 基于今天
            const todayBase = new Date();
            todayBase.setHours(0, 0, 0, 0);
            const fromTodayDate = addCycleToDate(todayBase, sim.cycle, cycleUnit);

            document.getElementById('renewSimInfo').innerHTML = \`<i class="fa-solid fa-sim-card mr-1"><\/i> \${sim.name}　|　周期: \${sim.cycle} \${unitLabel}\`;
            document.getElementById('renewPreviewExpiry').textContent = '新到期日：' + formatDateStr(fromExpiryDate);
            document.getElementById('renewPreviewToday').textContent = '新到期日：' + formatDateStr(fromTodayDate);

            const modal = document.getElementById('renewModal');
            const content = document.getElementById('renewModalContent');
            // 重置选择
            document.querySelector('input[name="renewMode"][value="fromExpiry"]').checked = true;

            modal.classList.remove('hidden');
            setTimeout(() => {
                content.classList.remove('scale-95', 'opacity-0');
                content.classList.add('scale-100', 'opacity-100');
            }, 10);
        }

        function closeRenewModal() {
            const modal = document.getElementById('renewModal');
            const content = document.getElementById('renewModalContent');
            content.classList.remove('scale-100', 'opacity-100');
            content.classList.add('scale-95', 'opacity-0');
            setTimeout(() => {
                modal.classList.add('hidden');
                renewTarget = null;
            }, 300);
        }

        async function confirmRenew() {
            if (!renewTarget) return;

            const mode = document.querySelector('input[name="renewMode"]:checked').value;
            const cycleUnit = renewTarget.cycleUnit || 'day';

            let baseDate;
            if (mode === 'fromExpiry') {
                const parts = renewTarget.expireDate.split('-');
                baseDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            } else {
                baseDate = new Date();
            }
            baseDate.setHours(0, 0, 0, 0);

            const newDate = addCycleToDate(baseDate, renewTarget.cycle, cycleUnit);
            const newExpireStr = formatDateStr(newDate);

            try {
                const response = await fetch(WORKER_API_URL, {
                    method: 'PUT',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ id: renewTarget.id, expireDate: newExpireStr })
                });
                
                if (response.status === 401) { logout(); return; }
                if (response.ok) {
                    closeRenewModal();
                    await fetchEsimData(); 
                } else {
                    alert("续期失败。");
                }
            } catch (error) {
                alert("网络错误，续期失败。");
            }
        }

        async function deleteEsim(id) {
            if (!confirm("确定要删除这个号码记录吗？")) return;
            
            try {
                const response = await fetch(WORKER_API_URL, {
                    method: 'DELETE',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ id: id })
                });
                
                if (response.status === 401) { logout(); return; }
                if (response.ok) {
                    await fetchEsimData(); 
                } else {
                    alert("删除失败。");
                }
            } catch (error) {
                alert("网络错误，删除失败。");
            }
        }

        function autoCalcExpireDate() {
            const cycleVal = parseInt(document.getElementById('simCycle').value);
            const cycleUnit = document.getElementById('simCycleUnit').value;
            const startDateStr = document.getElementById('simStartDate').value;
            if (cycleVal && cycleVal > 0 && startDateStr) {
                const parts = startDateStr.split('-');
                const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                const newDate = addCycleToDate(d, cycleVal, cycleUnit);
                document.getElementById('simExpire').value = formatDateStr(newDate);
                const unitLabel = getCycleUnitLabel(cycleUnit);
                document.getElementById('expireHint').innerHTML = '<i class="fa-solid fa-wand-magic-sparkles mr-1"><\/i>已自动计算：' + startDateStr + ' + ' + cycleVal + ' ' + unitLabel;
            } else {
                document.getElementById('expireHint').innerHTML = '';
            }
        }

        function getTodayStr() {
            return formatDateStr(new Date());
        }

        function openModal() {
            editingId = null;
            document.getElementById('modalTitle').innerHTML = '<i class="fa-solid fa-file-circle-plus text-blue-600"><\/i> 新增 eSIM';
            const modal = document.getElementById('addModal');
            const content = document.getElementById('modalContent');
            document.getElementById('addForm').reset();
            document.getElementById('simStartDate').value = getTodayStr();
            document.getElementById('simCycleUnit').value = 'day';
            document.getElementById('simAutoRenew').checked = false;
            document.getElementById('simReminderDays').value = '';
            document.getElementById('expireHint').innerHTML = '';
            
            modal.classList.remove('hidden');
            setTimeout(() => {
                content.classList.remove('scale-95', 'opacity-0');
                content.classList.add('scale-100', 'opacity-100');
            }, 10);
        }

        function openEditModal(id) {
            const sim = esimData.find(s => s.id === id);
            if (!sim) return;
            
            editingId = id;
            document.getElementById('modalTitle').innerHTML = '<i class="fa-solid fa-pen-to-square text-green-600"><\/i> 编辑 eSIM';
            
            document.getElementById('simName').value = sim.name || '';
            document.getElementById('simNumber').value = sim.number || '';
            document.getElementById('simStartDate').value = sim.startDate || getTodayStr();
            document.getElementById('simCycle').value = sim.cycle || '';
            document.getElementById('simCycleUnit').value = sim.cycleUnit || 'day';
            document.getElementById('simRemark').value = sim.remark || '';
            document.getElementById('simExpire').value = sim.expireDate || '';
            document.getElementById('simAutoRenew').checked = !!sim.autoRenew;
            document.getElementById('simReminderDays').value = sim.reminderDays || '';
            document.getElementById('expireHint').innerHTML = '';

            const modal = document.getElementById('addModal');
            const content = document.getElementById('modalContent');
            
            modal.classList.remove('hidden');
            setTimeout(() => {
                content.classList.remove('scale-95', 'opacity-0');
                content.classList.add('scale-100', 'opacity-100');
            }, 10);
        }

        function closeModal() {
            const modal = document.getElementById('addModal');
            const content = document.getElementById('modalContent');
            
            content.classList.remove('scale-100', 'opacity-100');
            content.classList.add('scale-95', 'opacity-0');
            
            setTimeout(() => {
                modal.classList.add('hidden');
                editingId = null;
            }, 300); 
        }
    <\/script>
</body>
</html>`;

// ================= HTML 转义工具（用于 TG 消息） =================
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ================= 周期计算（后端版本，UTC 安全） =================
function addCycleToDateUTC(baseDate, cycle, cycleUnit) {
    const d = new Date(baseDate.getTime());
    const c = parseInt(cycle);
    switch (cycleUnit) {
        case 'month':
            d.setUTCMonth(d.getUTCMonth() + c);
            break;
        case 'quarter':
            d.setUTCMonth(d.getUTCMonth() + c * 3);
            break;
        case 'year':
            d.setUTCFullYear(d.getUTCFullYear() + c);
            break;
        case 'day':
        default:
            d.setUTCDate(d.getUTCDate() + c);
            break;
    }
    return d;
}

function getCycleUnitLabelServer(unit) {
    const labels = { day: '天', month: '个月', quarter: '季度', year: '年' };
    return labels[unit] || '天';
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        const reqOrigin = request.headers.get("Origin");
        const allowedOrigin = reqOrigin && (reqOrigin.includes("workers.dev") || reqOrigin.includes("localhost") || reqOrigin === new URL(request.url).origin) ? reqOrigin : new URL(request.url).origin;

        const corsHeaders = {
            "Access-Control-Allow-Origin": allowedOrigin,
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        if (path === "/" || path === "/index.html") {
            return new Response(HTML_CONTENT, {
                headers: { "Content-Type": "text/html;charset=UTF-8" }
            });
        }

        let tgToken = env.TG_BOT_TOKEN;
        let tgChat = env.TG_CHAT_ID;

        try {
            if (!tgToken) tgToken = await env.ESIM_DB.get("TG_BOT_TOKEN");
            if (!tgChat) tgChat = await env.ESIM_DB.get("TG_CHAT_ID");
        } catch (e) { }

        if (path === "/api/auth/send" && request.method === "POST") {
            try {
                if (!tgToken || !tgChat) {
                    let missingVars = [];
                    if (!tgToken) missingVars.push("TG_BOT_TOKEN");
                    if (!tgChat) missingVars.push("TG_CHAT_ID");
                    return new Response(JSON.stringify({
                        success: false,
                        message: `环境缺失：缺少 ${missingVars.join(' 和 ')}。请前往 Cloudflare 的 KV 数据库中手动添加这两个键值对即可彻底解决！`
                    }), { status: 500, headers: corsHeaders });
                }

                const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
                const rlKey = `rate_limit_send_${clientIp}`;
                if (await env.ESIM_DB.get(rlKey)) {
                    return new Response(JSON.stringify({ success: false, message: "发送过于频繁，请等待 60 秒后再试。" }), { status: 429, headers: corsHeaders });
                }

                const randomBuffer = new Uint32Array(1);
                crypto.getRandomValues(randomBuffer);
                const code = (randomBuffer[0] % 900000 + 100000).toString();

                await env.ESIM_DB.put("admin_auth_code", code, { expirationTtl: 300 });
                await env.ESIM_DB.put(rlKey, "1", { expirationTtl: 60 });
                // Note: attempts rate limit initialization moved to verify

                const text = `🔐 <b>【eSIM 看板安全验证】</b>\n\n有人正在尝试登录您的网页版数据面板。\n\nIP: ${clientIp}\n您的动态登录验证码是：<code>${code}</code>\n\n<i>(该验证码 5 分钟内有效。如非本人操作，请忽略，系统已开启防爆破保护)</i>`;
                const tgUrl = `https://api.telegram.org/bot${tgToken}/sendMessage`;
                const tgRes = await fetch(tgUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: tgChat, text: text, parse_mode: "HTML" })
                });

                if (tgRes.ok) {
                    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
                } else {
                    return new Response(JSON.stringify({ success: false, message: "TG 消息发送失败，可能 Bot 被拉黑或未激活" }), { status: 500, headers: corsHeaders });
                }
            } catch (err) {
                return new Response(JSON.stringify({ success: false, message: err.message }), { status: 500, headers: corsHeaders });
            }
        }

        if (path === "/api/auth/verify" && request.method === "POST") {
            try {
                const { code } = await request.json();
                const storedCode = await env.ESIM_DB.get("admin_auth_code");

                const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
                const rlKeyAttempts = `rate_limit_attempts_${clientIp}`;

                let attempts = parseInt(await env.ESIM_DB.get(rlKeyAttempts)) || 0;
                if (attempts >= 5) {
                    await env.ESIM_DB.delete("admin_auth_code");
                    return new Response(JSON.stringify({ success: false, message: "错误次数过多，为保障安全，验证码已强制作废。请重新获取！" }), { status: 403, headers: corsHeaders });
                }

                if (!storedCode) {
                    return new Response(JSON.stringify({ success: false, message: "请先获取验证码或验证码已过期" }), { status: 400, headers: corsHeaders });
                }

                if (code && storedCode === code.toString()) {
                    const token = crypto.randomUUID();
                    await env.ESIM_DB.put("session_token_" + token, "valid", { expirationTtl: 2592000 });
                    await env.ESIM_DB.delete("admin_auth_code");
                    await env.ESIM_DB.delete(rlKeyAttempts);

                    return new Response(JSON.stringify({ success: true, token: token }), { headers: corsHeaders });
                } else {
                    attempts++;
                    await env.ESIM_DB.put(rlKeyAttempts, attempts.toString(), { expirationTtl: 300 });
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    return new Response(JSON.stringify({ success: false, message: `验证码错误！剩余尝试次数: ${5 - attempts} 次` }), { status: 401, headers: corsHeaders });
                }
            } catch (err) {
                return new Response(JSON.stringify({ success: false, message: "校验失败" }), { status: 500, headers: corsHeaders });
            }
        }

        // ================= 批量操作 API =================
        if (path === "/api/esims/batch") {
            const reqTokenRaw = request.headers.get("Authorization");
            const reqToken = reqTokenRaw ? reqTokenRaw.replace('Bearer ', '') : null;
            if (!reqToken) {
                return new Response(JSON.stringify({ error: "Unauthorized: Missing Token" }), { status: 401, headers: corsHeaders });
            }
            const isValidSession = await env.ESIM_DB.get("session_token_" + reqToken);
            if (!isValidSession) {
                return new Response(JSON.stringify({ error: "Unauthorized: Invalid or Expired Token" }), { status: 401, headers: corsHeaders });
            }

            let esims;
            try {
                esims = await env.ESIM_DB.get("esim_list", { type: "json" });
                if (!esims) esims = [];
            } catch (err) {
                return new Response(JSON.stringify({ error: "KV 未绑定" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
            }

            // 批量续期
            if (request.method === "PUT") {
                try {
                    const { updates } = await request.json();
                    if (!Array.isArray(updates)) {
                        return new Response(JSON.stringify({ success: false, message: "参数错误" }), { status: 400, headers: corsHeaders });
                    }
                    const updateMap = {};
                    updates.forEach(u => { updateMap[u.id] = u.expireDate; });
                    
                    esims = esims.map(sim => {
                        if (updateMap[sim.id]) {
                            sim.expireDate = updateMap[sim.id];
                        }
                        return sim;
                    });

                    await env.ESIM_DB.put("esim_list", JSON.stringify(esims));
                    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
                } catch (err) {
                    return new Response(JSON.stringify({ success: false }), { status: 400, headers: corsHeaders });
                }
            }

            // 批量删除
            if (request.method === "DELETE") {
                try {
                    const { ids } = await request.json();
                    if (!Array.isArray(ids)) {
                        return new Response(JSON.stringify({ success: false, message: "参数错误" }), { status: 400, headers: corsHeaders });
                    }
                    const idsSet = new Set(ids);
                    esims = esims.filter(sim => !idsSet.has(sim.id));
                    await env.ESIM_DB.put("esim_list", JSON.stringify(esims));
                    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
                } catch (err) {
                    return new Response(JSON.stringify({ success: false }), { status: 400, headers: corsHeaders });
                }
            }

            return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
        }

        // ================= 单卡 CRUD API =================
        if (path === "/api/esims") {
            const reqTokenRaw = request.headers.get("Authorization");
            const reqToken = reqTokenRaw ? reqTokenRaw.replace('Bearer ', '') : null;
            if (!reqToken) {
                return new Response(JSON.stringify({ error: "Unauthorized: Missing Token" }), { status: 401, headers: corsHeaders });
            }

            const isValidSession = await env.ESIM_DB.get("session_token_" + reqToken);
            if (!isValidSession) {
                return new Response(JSON.stringify({ error: "Unauthorized: Invalid or Expired Token" }), { status: 401, headers: corsHeaders });
            }

            let esims;
            try {
                esims = await env.ESIM_DB.get("esim_list", { type: "json" });
                if (!esims) esims = [];
            } catch (err) {
                return new Response(JSON.stringify({ error: "KV 未绑定" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
            }

            if (request.method === "GET") {
                return new Response(JSON.stringify(esims), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }

            if (request.method === "POST") {
                try {
                    const newSim = await request.json();
                    if (typeof newSim.name !== 'string' || !newSim.name || typeof newSim.expireDate !== 'string' || !newSim.expireDate) return new Response(JSON.stringify({ success: false, message: "参数错误" }), { status: 400, headers: corsHeaders });
                    
                    newSim.name = newSim.name.substring(0, 100);
                    if (newSim.number) newSim.number = String(newSim.number).substring(0, 50);
                    if (newSim.remark) newSim.remark = String(newSim.remark).substring(0, 500);

                    // 【BUG FIX】使用 crypto.randomUUID() 避免并发碰撞
                    newSim.id = crypto.randomUUID();
                    // 确保新字段有默认值
                    if (!newSim.cycleUnit) newSim.cycleUnit = 'day';
                    if (!newSim.reminderDays) newSim.reminderDays = 15;
                    esims.push(newSim);
                    await env.ESIM_DB.put("esim_list", JSON.stringify(esims));
                    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
                } catch (err) { return new Response(JSON.stringify({ success: false }), { status: 400, headers: corsHeaders }); }
            }

            if (request.method === "PUT") {
                try {
                    const body = await request.json();
                    const { id, expireDate, name, number, startDate, cycle, cycleUnit, remark, autoRenew, reminderDays } = body;
                    let found = false;
                    esims = esims.map(sim => {
                        if (sim.id === id) {
                            found = true;
                            if (expireDate !== undefined) sim.expireDate = String(expireDate);
                            if (name !== undefined) sim.name = String(name).substring(0, 100);
                            if (number !== undefined) sim.number = String(number).substring(0, 50);
                            if (startDate !== undefined) sim.startDate = String(startDate);
                            if (cycle !== undefined) sim.cycle = parseInt(cycle) || 0;
                            if (cycleUnit !== undefined) sim.cycleUnit = String(cycleUnit);
                            if (remark !== undefined) sim.remark = String(remark).substring(0, 500);
                            if (autoRenew !== undefined) sim.autoRenew = !!autoRenew;
                            if (reminderDays !== undefined) sim.reminderDays = parseInt(reminderDays) || 15;
                            return sim;
                        }
                        return sim;
                    });
                    if (!found) return new Response(JSON.stringify({ success: false, message: "未找到记录" }), { status: 404, headers: corsHeaders });
                    await env.ESIM_DB.put("esim_list", JSON.stringify(esims));
                    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
                } catch (err) { return new Response(JSON.stringify({ success: false }), { status: 400, headers: corsHeaders }); }
            }

            if (request.method === "DELETE") {
                try {
                    const { id } = await request.json();
                    // 【BUG FIX】验证 ID 存在性
                    const originalLength = esims.length;
                    esims = esims.filter(sim => sim.id !== id);
                    if (esims.length === originalLength) {
                        return new Response(JSON.stringify({ success: false, message: "未找到记录" }), { status: 404, headers: corsHeaders });
                    }
                    await env.ESIM_DB.put("esim_list", JSON.stringify(esims));
                    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
                } catch (err) { return new Response(JSON.stringify({ success: false }), { status: 400, headers: corsHeaders }); }
            }
        }

        return new Response("404 Not Found", { status: 404 });
    },

    async scheduled(event, env, ctx) {
        let tgToken = env.TG_BOT_TOKEN;
        let tgChat = env.TG_CHAT_ID;
        try {
            if (!tgToken) tgToken = await env.ESIM_DB.get("TG_BOT_TOKEN");
            if (!tgChat) tgChat = await env.ESIM_DB.get("TG_CHAT_ID");
        } catch (e) { }

        const esims = await env.ESIM_DB.get("esim_list", { type: "json" });
        if (!esims || esims.length === 0) return;

        const today = new Date();
        const offset = 8;
        const localToday = new Date(today.getTime() + offset * 3600 * 1000);
        localToday.setUTCHours(0, 0, 0, 0);

        let messages = [];

        let dataChanged = false;

        esims.forEach(sim => {
            const expDate = new Date(sim.expireDate);
            expDate.setUTCHours(0, 0, 0, 0);

            const diffTime = expDate - localToday;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            const cycleUnit = sim.cycleUnit || 'day';
            const unitLabel = getCycleUnitLabelServer(cycleUnit);
            const cycleText = sim.cycle ? `${sim.cycle}${unitLabel}` : '未设置';
            // 【BUG FIX】对用户输入进行 HTML 转义，防止 TG API 解析失败
            const safeName = escapeHTML(sim.name);
            const safeNumber = escapeHTML(sim.number || '未填写');
            const safeRemark = sim.remark ? escapeHTML(sim.remark) : '';
            const remarkText = safeRemark ? `\n📝 备注: ${safeRemark}` : '';
            const reminderDays = sim.reminderDays || 15;

            // 自动延期逻辑：到期当天（或已过期）且开启了自动延期
            if (diffDays <= 0 && sim.autoRenew && sim.cycle && sim.cycle > 0) {
                const newDate = addCycleToDateUTC(localToday, sim.cycle, cycleUnit);
                const y = newDate.getUTCFullYear();
                const m = String(newDate.getUTCMonth() + 1).padStart(2, '0');
                const d = String(newDate.getUTCDate()).padStart(2, '0');
                sim.expireDate = y + '-' + m + '-' + d;
                dataChanged = true;
                messages.push(`🔄 <b>【eSIM 自动延期通知】</b>\n📱 卡名: ${safeName}\n📞 号码: ${safeNumber}\n🔄 周期: ${cycleText}\n📅 新到期日: ${sim.expireDate}${remarkText}\n✅ 系统已自动顺延一个保号周期。`);
                return;
            }

            // 【BUG FIX】修复逻辑死区：diffDays === 0 时单独处理"今日到期"紧急提醒
            if (diffDays === 0) {
                messages.push(`🚨 <b>【eSIM 紧急提醒】</b>\n📱 卡名: ${safeName} 今天到期！${remarkText}\n👉 请立即处理！`);
            } else if (diffDays > 0 && diffDays <= reminderDays) {
                messages.push(`⚠️ <b>【eSIM 保号提醒】</b>\n📱 卡名: ${safeName}\n📞 号码: ${safeNumber}\n🔄 周期: ${cycleText}\n📅 到期: ${sim.expireDate}${remarkText}\n⏳ 剩余: ${diffDays} 天！\n👉 请尽快处理续期！`);
            } else if (diffDays < 0 && Math.abs(diffDays) % 7 === 0) {
                messages.push(`❌ <b>【eSIM 停机警告】</b>\n📱 卡名: ${safeName} 已过期 ${Math.abs(diffDays)} 天。${remarkText}`);
            }
        });

        // 如果有自动延期操作，将更新后的数据写回 KV
        if (dataChanged) {
            await env.ESIM_DB.put("esim_list", JSON.stringify(esims));
        }

        if (messages.length > 0 && tgToken && tgChat) {
            const text = messages.join("\n\n---\n\n");
            const tgUrl = `https://api.telegram.org/bot${tgToken}/sendMessage`;
            await fetch(tgUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: tgChat,
                    text: text,
                    parse_mode: "HTML"
                })
            });
        }
    }
};
