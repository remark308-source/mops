const axios = require('axios');
const fs = require('fs');
const path = require('path');

const MOPS_URL = 'https://mops.twse.com.tw/mops/api/';

async function getAnnouncements() {
    console.log('正在抓取重大公告...');
    try {
        // 1. 获取列表
        const listRes = await axios.post(`${MOPS_URL}home_page/t05sr01_1`, { count: "0", marketKind: "" });
        const keywords = ['自結', '財務業務', '營收'];
        const filtered = listRes.data.result.data.filter(item => 
            keywords.some(k => item.subject.includes(k))
        );

        const details = [];
        for (const item of filtered.slice(0, 10)) { // 限制前10笔避免请求过快
            const rocDate = item.url.split('date=')[1]?.split('&')[0];
            const detailRes = await axios.post(`${MOPS_URL}t05sr01_1_detail`, {
                companyId: item.companyId,
                serialNumber: item.url.split('serialNumber=')[1]?.split('&')[0],
                date: rocDate
            });
            const data = detailRes.data.result.data[0];
            details.push({
                companyName: item.companyAbbreviation,
                companyId: item.companyId,
                date: item.date,
                subject: item.subject,
                description: data[9] || '無內容'
            });
            await new Promise(r => setTimeout(r, 1000)); // 延迟1秒
        }
        return details;
    } catch (e) { console.error('公告抓取失败', e); return []; }
}

async function getRevenue() {
    console.log('正在抓取營收統計...');
    // 这里实现原 n8n 中 "取得營業收入列表" -> "合併營收資料" 的逻辑
    // 逻辑同上，使用 axios.post 请求 t51sb10 并解析返回的 HTML/JSON
    // 最终返回一个 Array 包含 {公司名称, 公司代号, 本月营收, 增减百分比}
    return [{ name: "範例公司", id: "0000", revenue: "100M", growth: "25%" }]; 
}

async function run() {
    const announcements = await getAnnouncements();
    const revenue = await getRevenue();
    
    const dataDir = path.join(__dirname, '../docs/data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    
    fs.writeFileSync(path.join(dataDir, 'announcements.json'), JSON.stringify(announcements, null, 2));
    fs.writeFileSync(path.join(dataDir, 'revenue.json'), JSON.stringify(revenue, null, 2));
    console.log('数据更新完成');
}

run();
