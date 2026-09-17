// ================= 国旗字典配置（ISO 3166-1 alpha-2 国家代码）=================
// 使用 flagcdn.com SVG 图片代替 emoji，彻底解决 Windows / 老旧安卓 / 部分浏览器上
// 国旗 emoji 显示为字母代码（如 US、CN）的兼容性问题。
// 涵盖 ~170 个国家和地区，含 NANP (+1xxx) 精确匹配。
// 匹配算法按前缀长度降序排列，自动优先匹配最长区号。
const countryFlags = [
  // ===== NANP +1 子区号（北美及加勒比海精确匹配）=====
  { prefix: "+1242", codes: ["bs"] }, // 巴哈马
  { prefix: "+1246", codes: ["bb"] }, // 巴巴多斯
  { prefix: "+1264", codes: ["ai"] }, // 安圭拉
  { prefix: "+1268", codes: ["ag"] }, // 安提瓜和巴布达
  { prefix: "+1284", codes: ["vg"] }, // 英属维尔京群岛
  { prefix: "+1340", codes: ["vi"] }, // 美属维尔京群岛
  { prefix: "+1345", codes: ["ky"] }, // 开曼群岛
  { prefix: "+1441", codes: ["bm"] }, // 百慕大
  { prefix: "+1473", codes: ["gd"] }, // 格林纳达
  { prefix: "+1649", codes: ["tc"] }, // 特克斯和凯科斯群岛
  { prefix: "+1658", codes: ["jm"] }, // 牙买加（备用区号）
  { prefix: "+1664", codes: ["ms"] }, // 蒙特塞拉特
  { prefix: "+1670", codes: ["mp"] }, // 北马里亚纳群岛
  { prefix: "+1671", codes: ["gu"] }, // 关岛
  { prefix: "+1684", codes: ["as"] }, // 美属萨摩亚
  { prefix: "+1721", codes: ["sx"] }, // 荷属圣马丁
  { prefix: "+1758", codes: ["lc"] }, // 圣卢西亚
  { prefix: "+1767", codes: ["dm"] }, // 多米尼克
  { prefix: "+1784", codes: ["vc"] }, // 圣文森特和格林纳丁斯
  { prefix: "+1787", codes: ["pr"] }, // 波多黎各
  { prefix: "+1809", codes: ["do"] }, // 多米尼加共和国
  { prefix: "+1829", codes: ["do"] }, // 多米尼加共和国（备用）
  { prefix: "+1849", codes: ["do"] }, // 多米尼加共和国（备用）
  { prefix: "+1868", codes: ["tt"] }, // 特立尼达和多巴哥
  { prefix: "+1869", codes: ["kn"] }, // 圣基茨和尼维斯
  { prefix: "+1876", codes: ["jm"] }, // 牙买加
  { prefix: "+1939", codes: ["pr"] }, // 波多黎各（备用）
  // ===== +1 通用回退 =====
  { prefix: "+1", codes: ["us", "ca"] }, // 美国/加拿大
  // ===== +7 子区号 =====
  { prefix: "+77", codes: ["kz"] }, // 哈萨克斯坦（+77xx）
  { prefix: "+7", codes: ["ru"] }, // 俄罗斯
  // ===== 亚洲 =====
  { prefix: "+86", codes: ["cn"] }, // 中国大陆
  { prefix: "+852", codes: ["hk"] }, // 中国香港
  { prefix: "+853", codes: ["mo"] }, // 中国澳门
  { prefix: "+886", codes: ["tw"] }, // 中国台湾
  { prefix: "+81", codes: ["jp"] }, // 日本
  { prefix: "+82", codes: ["kr"] }, // 韩国
  { prefix: "+850", codes: ["kp"] }, // 朝鲜
  { prefix: "+65", codes: ["sg"] }, // 新加坡
  { prefix: "+60", codes: ["my"] }, // 马来西亚
  { prefix: "+66", codes: ["th"] }, // 泰国
  { prefix: "+62", codes: ["id"] }, // 印度尼西亚
  { prefix: "+63", codes: ["ph"] }, // 菲律宾
  { prefix: "+84", codes: ["vn"] }, // 越南
  { prefix: "+91", codes: ["in"] }, // 印度
  { prefix: "+92", codes: ["pk"] }, // 巴基斯坦
  { prefix: "+93", codes: ["af"] }, // 阿富汗
  { prefix: "+94", codes: ["lk"] }, // 斯里兰卡
  { prefix: "+95", codes: ["mm"] }, // 缅甸
  { prefix: "+855", codes: ["kh"] }, // 柬埔寨
  { prefix: "+856", codes: ["la"] }, // 老挝
  { prefix: "+880", codes: ["bd"] }, // 孟加拉国
  { prefix: "+960", codes: ["mv"] }, // 马尔代夫
  { prefix: "+975", codes: ["bt"] }, // 不丹
  { prefix: "+976", codes: ["mn"] }, // 蒙古
  { prefix: "+977", codes: ["np"] }, // 尼泊尔
  { prefix: "+98", codes: ["ir"] }, // 伊朗
  { prefix: "+964", codes: ["iq"] }, // 伊拉克
  { prefix: "+962", codes: ["jo"] }, // 约旦
  { prefix: "+961", codes: ["lb"] }, // 黎巴嫩
  { prefix: "+963", codes: ["sy"] }, // 叙利亚
  { prefix: "+967", codes: ["ye"] }, // 也门
  { prefix: "+968", codes: ["om"] }, // 阿曼
  { prefix: "+970", codes: ["ps"] }, // 巴勒斯坦
  { prefix: "+971", codes: ["ae"] }, // 阿联酋
  { prefix: "+972", codes: ["il"] }, // 以色列
  { prefix: "+973", codes: ["bh"] }, // 巴林
  { prefix: "+974", codes: ["qa"] }, // 卡塔尔
  { prefix: "+966", codes: ["sa"] }, // 沙特阿拉伯
  { prefix: "+965", codes: ["kw"] }, // 科威特
  { prefix: "+994", codes: ["az"] }, // 阿塞拜疆
  { prefix: "+993", codes: ["tm"] }, // 土库曼斯坦
  { prefix: "+992", codes: ["tj"] }, // 塔吉克斯坦
  { prefix: "+998", codes: ["uz"] }, // 乌兹别克斯坦
  { prefix: "+996", codes: ["kg"] }, // 吉尔吉斯斯坦
  // ===== 大洋洲 =====
  { prefix: "+61", codes: ["au"] }, // 澳大利亚
  { prefix: "+64", codes: ["nz"] }, // 新西兰
  { prefix: "+675", codes: ["pg"] }, // 巴布亚新几内亚
  { prefix: "+679", codes: ["fj"] }, // 斐济
  { prefix: "+676", codes: ["to"] }, // 汤加
  { prefix: "+685", codes: ["ws"] }, // 萨摩亚
  { prefix: "+678", codes: ["vu"] }, // 瓦努阿图
  { prefix: "+677", codes: ["sb"] }, // 所罗门群岛
  { prefix: "+686", codes: ["ki"] }, // 基里巴斯
  { prefix: "+688", codes: ["tv"] }, // 图瓦卢
  { prefix: "+691", codes: ["fm"] }, // 密克罗尼西亚
  { prefix: "+692", codes: ["mh"] }, // 马绍尔群岛
  { prefix: "+680", codes: ["pw"] }, // 帕劳
  { prefix: "+682", codes: ["ck"] }, // 库克群岛
  { prefix: "+674", codes: ["nr"] }, // 瑙鲁
  { prefix: "+689", codes: ["pf"] }, // 法属波利尼西亚
  { prefix: "+687", codes: ["nc"] }, // 新喀里多尼亚
  // ===== 欧洲 =====
  { prefix: "+44", codes: ["gb"] }, // 英国
  { prefix: "+33", codes: ["fr"] }, // 法国
  { prefix: "+49", codes: ["de"] }, // 德国
  { prefix: "+39", codes: ["it"] }, // 意大利
  { prefix: "+34", codes: ["es"] }, // 西班牙
  { prefix: "+351", codes: ["pt"] }, // 葡萄牙
  { prefix: "+31", codes: ["nl"] }, // 荷兰
  { prefix: "+32", codes: ["be"] }, // 比利时
  { prefix: "+41", codes: ["ch"] }, // 瑞士
  { prefix: "+43", codes: ["at"] }, // 奥地利
  { prefix: "+46", codes: ["se"] }, // 瑞典
  { prefix: "+47", codes: ["no"] }, // 挪威
  { prefix: "+48", codes: ["pl"] }, // 波兰
  { prefix: "+45", codes: ["dk"] }, // 丹麦
  { prefix: "+358", codes: ["fi"] }, // 芬兰
  { prefix: "+30", codes: ["gr"] }, // 希腊
  { prefix: "+353", codes: ["ie"] }, // 爱尔兰
  { prefix: "+354", codes: ["is"] }, // 冰岛
  { prefix: "+352", codes: ["lu"] }, // 卢森堡
  { prefix: "+356", codes: ["mt"] }, // 马耳他
  { prefix: "+357", codes: ["cy"] }, // 塞浦路斯
  { prefix: "+36", codes: ["hu"] }, // 匈牙利
  { prefix: "+40", codes: ["ro"] }, // 罗马尼亚
  { prefix: "+359", codes: ["bg"] }, // 保加利亚
  { prefix: "+420", codes: ["cz"] }, // 捷克
  { prefix: "+421", codes: ["sk"] }, // 斯洛伐克
  { prefix: "+386", codes: ["si"] }, // 斯洛文尼亚
  { prefix: "+385", codes: ["hr"] }, // 克罗地亚
  { prefix: "+387", codes: ["ba"] }, // 波黑
  { prefix: "+381", codes: ["rs"] }, // 塞尔维亚
  { prefix: "+382", codes: ["me"] }, // 黑山
  { prefix: "+383", codes: ["xk"] }, // 科索沃
  { prefix: "+389", codes: ["mk"] }, // 北马其顿
  { prefix: "+355", codes: ["al"] }, // 阿尔巴尼亚
  { prefix: "+370", codes: ["lt"] }, // 立陶宛
  { prefix: "+371", codes: ["lv"] }, // 拉脱维亚
  { prefix: "+372", codes: ["ee"] }, // 爱沙尼亚
  { prefix: "+373", codes: ["md"] }, // 摩尔多瓦
  { prefix: "+374", codes: ["am"] }, // 亚美尼亚
  { prefix: "+375", codes: ["by"] }, // 白俄罗斯
  { prefix: "+380", codes: ["ua"] }, // 乌克兰
  { prefix: "+995", codes: ["ge"] }, // 格鲁吉亚
  { prefix: "+90", codes: ["tr"] }, // 土耳其
  { prefix: "+377", codes: ["mc"] }, // 摩纳哥
  { prefix: "+378", codes: ["sm"] }, // 圣马力诺
  { prefix: "+376", codes: ["ad"] }, // 安道尔
  { prefix: "+423", codes: ["li"] }, // 列支敦士登
  // ===== 非洲 =====
  { prefix: "+20", codes: ["eg"] }, // 埃及
  { prefix: "+27", codes: ["za"] }, // 南非
  { prefix: "+212", codes: ["ma"] }, // 摩洛哥
  { prefix: "+213", codes: ["dz"] }, // 阿尔及利亚
  { prefix: "+216", codes: ["tn"] }, // 突尼斯
  { prefix: "+218", codes: ["ly"] }, // 利比亚
  { prefix: "+220", codes: ["gm"] }, // 冈比亚
  { prefix: "+221", codes: ["sn"] }, // 塞内加尔
  { prefix: "+222", codes: ["mr"] }, // 毛里塔尼亚
  { prefix: "+223", codes: ["ml"] }, // 马里
  { prefix: "+224", codes: ["gn"] }, // 几内亚
  { prefix: "+225", codes: ["ci"] }, // 科特迪瓦
  { prefix: "+226", codes: ["bf"] }, // 布基纳法索
  { prefix: "+227", codes: ["ne"] }, // 尼日尔
  { prefix: "+228", codes: ["tg"] }, // 多哥
  { prefix: "+229", codes: ["bj"] }, // 贝宁
  { prefix: "+230", codes: ["mu"] }, // 毛里求斯
  { prefix: "+231", codes: ["lr"] }, // 利比里亚
  { prefix: "+232", codes: ["sl"] }, // 塞拉利昂
  { prefix: "+233", codes: ["gh"] }, // 加纳
  { prefix: "+234", codes: ["ng"] }, // 尼日利亚
  { prefix: "+235", codes: ["td"] }, // 乍得
  { prefix: "+236", codes: ["cf"] }, // 中非共和国
  { prefix: "+237", codes: ["cm"] }, // 喀麦隆
  { prefix: "+238", codes: ["cv"] }, // 佛得角
  { prefix: "+239", codes: ["st"] }, // 圣多美和普林西比
  { prefix: "+240", codes: ["gq"] }, // 赤道几内亚
  { prefix: "+241", codes: ["ga"] }, // 加蓬
  { prefix: "+242", codes: ["cg"] }, // 刚果（布）
  { prefix: "+243", codes: ["cd"] }, // 刚果（金）
  { prefix: "+244", codes: ["ao"] }, // 安哥拉
  { prefix: "+245", codes: ["gw"] }, // 几内亚比绍
  { prefix: "+248", codes: ["sc"] }, // 塞舌尔
  { prefix: "+249", codes: ["sd"] }, // 苏丹
  { prefix: "+250", codes: ["rw"] }, // 卢旺达
  { prefix: "+251", codes: ["et"] }, // 埃塞俄比亚
  { prefix: "+252", codes: ["so"] }, // 索马里
  { prefix: "+253", codes: ["dj"] }, // 吉布提
  { prefix: "+254", codes: ["ke"] }, // 肯尼亚
  { prefix: "+255", codes: ["tz"] }, // 坦桑尼亚
  { prefix: "+256", codes: ["ug"] }, // 乌干达
  { prefix: "+257", codes: ["bi"] }, // 布隆迪
  { prefix: "+258", codes: ["mz"] }, // 莫桑比克
  { prefix: "+260", codes: ["zm"] }, // 赞比亚
  { prefix: "+261", codes: ["mg"] }, // 马达加斯加
  { prefix: "+262", codes: ["re"] }, // 留尼汪
  { prefix: "+263", codes: ["zw"] }, // 津巴布韦
  { prefix: "+264", codes: ["na"] }, // 纳米比亚
  { prefix: "+265", codes: ["mw"] }, // 马拉维
  { prefix: "+266", codes: ["ls"] }, // 莱索托
  { prefix: "+267", codes: ["bw"] }, // 博茨瓦纳
  { prefix: "+268", codes: ["sz"] }, // 斯威士兰
  { prefix: "+269", codes: ["km"] }, // 科摩罗
  { prefix: "+211", codes: ["ss"] }, // 南苏丹
  { prefix: "+291", codes: ["er"] }, // 厄立特里亚
  { prefix: "+297", codes: ["aw"] }, // 阿鲁巴
  // ===== 美洲（非 NANP）=====
  { prefix: "+52", codes: ["mx"] }, // 墨西哥
  { prefix: "+53", codes: ["cu"] }, // 古巴
  { prefix: "+54", codes: ["ar"] }, // 阿根廷
  { prefix: "+55", codes: ["br"] }, // 巴西
  { prefix: "+56", codes: ["cl"] }, // 智利
  { prefix: "+57", codes: ["co"] }, // 哥伦比亚
  { prefix: "+58", codes: ["ve"] }, // 委内瑞拉
  { prefix: "+51", codes: ["pe"] }, // 秘鲁
  { prefix: "+502", codes: ["gt"] }, // 危地马拉
  { prefix: "+503", codes: ["sv"] }, // 萨尔瓦多
  { prefix: "+504", codes: ["hn"] }, // 洪都拉斯
  { prefix: "+505", codes: ["ni"] }, // 尼加拉瓜
  { prefix: "+506", codes: ["cr"] }, // 哥斯达黎加
  { prefix: "+507", codes: ["pa"] }, // 巴拿马
  { prefix: "+509", codes: ["ht"] }, // 海地
  { prefix: "+591", codes: ["bo"] }, // 玻利维亚
  { prefix: "+592", codes: ["gy"] }, // 圭亚那
  { prefix: "+593", codes: ["ec"] }, // 厄瓜多尔
  { prefix: "+595", codes: ["py"] }, // 巴拉圭
  { prefix: "+597", codes: ["sr"] }, // 苏里南
  { prefix: "+598", codes: ["uy"] }, // 乌拉圭
  { prefix: "+599", codes: ["cw"] }, // 库拉索
  { prefix: "+500", codes: ["fk"] }, // 福克兰群岛
  { prefix: "+501", codes: ["bz"] }, // 伯利兹
  { prefix: "+594", codes: ["gf"] }, // 法属圭亚那
  { prefix: "+596", codes: ["mq"] }, // 马提尼克
  { prefix: "+590", codes: ["gp"] }, // 瓜德罗普
  // ===== 补充非洲/领地 =====
  { prefix: "+246", codes: ["io"] }, // 英属印度洋领地
  { prefix: "+247", codes: ["sh"] }, // 阿森松岛
  { prefix: "+290", codes: ["sh"] }, // 圣赫勒拿
  { prefix: "+298", codes: ["fo"] }, // 法罗群岛
  { prefix: "+299", codes: ["gl"] }, // 格陵兰
  // ===== 补充欧洲领地 =====
  { prefix: "+350", codes: ["gi"] }, // 直布罗陀
  { prefix: "+379", codes: ["va"] }, // 梵蒂冈
  // ===== 补充亚洲 =====
  { prefix: "+670", codes: ["tl"] }, // 东帝汶
  { prefix: "+672", codes: ["nf"] }, // 诺福克岛
  { prefix: "+673", codes: ["bn"] }, // 文莱
  // ===== 补充太平洋 =====
  { prefix: "+681", codes: ["wf"] }, // 瓦利斯和富图纳
  { prefix: "+683", codes: ["nu"] }, // 纽埃
  { prefix: "+690", codes: ["tk"] }, // 托克劳
  // ===== 补充中美 =====
  { prefix: "+508", codes: ["pm"] }, // 圣皮埃尔和密克隆
];

// 预排序一次（按前缀长度降序），优先匹配最长区号（如 +1242 优先于 +1）
const sortedCountryFlags = [...countryFlags].sort(
  (a, b) => b.prefix.length - a.prefix.length,
);

// 根据 ISO 国家代码生成 flagcdn.com 的 SVG 旗帜 <img> 标签
// 彻底解决 Windows / 安卓 / 老旧浏览器上 emoji 旗帜显示为字母的问题
function buildFlagImg(code, extraClass) {
  const cls = "flag-icon" + (extraClass ? " " + extraClass : "");
  return (
    '<img src="https://flagcdn.com/' +
    code +
    '.svg" alt="' +
    code.toUpperCase() +
    '" class="' +
    cls +
    '" loading="lazy">'
  );
}

function getCountryFlag(numberStr) {
  if (!numberStr) return '<i class="fa-solid fa-phone text-gray-400"></i>';
  const cleanNumber = numberStr.replace(/[\s\-\(\)\.]/g, "");
  if (!cleanNumber.startsWith("+"))
    return '<i class="fa-solid fa-globe text-gray-400"></i>';

  for (let item of sortedCountryFlags) {
    if (cleanNumber.startsWith(item.prefix)) {
      if (item.codes.length === 1) {
        return buildFlagImg(item.codes[0]);
      }
      // 多国共享区号（如 +1 美国/加拿大）：显示多面小旗帜
      return (
        '<span class="flag-group">' +
        item.codes.map((c) => buildFlagImg(c, "flag-icon-sm")).join("") +
        "</span>"
      );
    }
  }
  return '<i class="fa-solid fa-globe text-gray-400"></i>';
}
