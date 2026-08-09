const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 模拟浏览器的请求头，防止被封
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Origin': 'https://mops.twse.com.tw',
    'Referer': 'https://mops.twse.com.tw/mops/web/t05sr01_1'
};

async function run() {
    // 确保数据存储目录存在
    const dataDir = path.join(__dirname, '../docs/data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    try {
        console.log('正在从公开资讯观测站获取数据...');
        
        // 1. 抓取重大公告
        const annRes = await axios.post('https://mops.twse.com.tw/mops/api/home_page/t05sr01_1', 
            { count: "0", marketKind: "" }, { headers });
        
        const keywords = ['自結', '財務業務', '營收'];
        const announcements = (annRes.data?.result?.data || [])
            .filter(item => keywords.some(k => item.subject.includes(k)))
            .slice(0, 10)
            .map(item => ({
                name: item.companyAbbreviation,
                id: item.companyId,
                date: item.date,
                subject: item.subject
            }));

        // 2. 模拟营收数据 (先确保逻辑通畅，后续可根据需要扩展营收抓取)
        const revenue = [
            { name: "数据更新中", id: "0000", revenue: "N/A", growth: "0%" }
        ];

        // 写入文件
        fs.writeFileSync(path.join(dataDir, 'announcements.json'), JSON.stringify(announcements, null, 2));
        fs.writeFileSync(path.join(dataDir, 'revenue.json'), JSON.stringify(revenue, null, 2));
        
        console.log(`成功抓取 ${announcements.length} 条公告并保存。`);
    } catch (error) {
        console.error('抓取过程中出错:', error.message);
        // 出错时写入空数组防止页面白屏
        fs.writeFileSync(path.join(dataDir, 'announcements.json'), JSON.stringify([], null, 2));
        fs.writeFileSync(path.join(dataDir, 'revenue.json'), JSON.stringify([], null, 2));
    }
}

run();
