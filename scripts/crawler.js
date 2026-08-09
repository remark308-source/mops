const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 模拟浏览器的 Headers
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Origin': 'https://mops.twse.com.tw',
    'Referer': 'https://mops.twse.com.tw/mops/web/t05sr01_1'
};

async function run() {
    const dataDir = path.join(__dirname, '../docs/data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    try {
        console.log('正在获取公告列表...');
        const res = await axios.post('https://mops.twse.com.tw/mops/api/home_page/t05sr01_1', 
            { count: "0", marketKind: "" }, { headers });
        
        const announcements = (res.data?.result?.data || [])
            .filter(item => ['自結', '財務業務', '營收'].some(k => item.subject.includes(k)))
            .slice(0, 5) // 先取5笔测试
            .map(item => ({
                companyName: item.companyAbbreviation,
                companyId: item.companyId,
                date: item.date,
                subject: item.subject,
                description: "點擊查看詳情" // 简化处理
            }));

        fs.writeFileSync(path.join(dataDir, 'announcements.json'), JSON.stringify(announcements, null, 2));
        
        // 模拟营收数据（先确保页面能跑通）
        const mockRevenue = [
            { name: "台積電", id: "2330", revenue: "200,000M", growth: "25.5%" },
            { name: "鴻海", id: "2317", revenue: "150,000M", growth: "12.3%" }
        ];
        fs.writeFileSync(path.join(dataDir, 'revenue.json'), JSON.stringify(mockRevenue, null, 2));
        
        console.log(`成功写入 ${announcements.length} 条公告`);
    } catch (e) {
        console.error('抓取失败:', e.message);
        // 即使失败也写入空数组，防止前端卡死
        fs.writeFileSync(path.join(dataDir, 'announcements.json'), JSON.stringify([], null, 2));
        fs.writeFileSync(path.join(dataDir, 'revenue.json'), JSON.stringify([], null, 2));
    }
}

run();
