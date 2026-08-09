const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 模拟浏览器的请求头
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Origin': 'https://mops.twse.com.tw',
    'Referer': 'https://mops.twse.com.tw/mops/web/t05st10_ifrs'
};

// 解析营收 HTML 的工具函数
function parseRevenueHtml(html) {
    let result = { revenue: "N/A", growth: "0%", id: "", name: "" };
    try {
        const idMatch = html.match(/name='compID'\s*value='(\d+)'/i);
        result.id = idMatch ? idMatch[1] : "";
        
        const nameMatch = html.match(/本資料由\s*\(.*?\)\s*([^\s ]+)/);
        result.name = nameMatch ? nameMatch[1].trim() : "";

        // 提取本月營收
        const revMatch = html.match(/本月[^<]*?<TD[^>]*>([\d,.]+)/i);
        result.revenue = revMatch ? revMatch[1] : "N/A";

        // 提取增減百分比 (去年同月增減)
        // MOPS 的表格結構較複雜，這裡精確匹配增減百分比數值
        const growthMatch = html.match(/增減百分比[^<]*?<TD[^>]*>([\d,.-]+)/i);
        result.growth = growthMatch ? growthMatch[1] + "%" : "0%";
    } catch (e) {
        console.error("解析HTML出錯", e);
    }
    return result;
}

async function run() {
    const dataDir = path.join(__dirname, '../docs/data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    try {
        console.log('1. 正在抓取重大公告列表...');
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

        console.log('2. 正在抓取營業收入列表...');
        const revListRes = await axios.post('https://mops.twse.com.tw/mops/api/t51sb10', 
            { count: "0", marketKind: "" }, { headers });
        
        // 篩選出今天發布的營收資訊公告
        const revAnnouncements = (revListRes.data?.result?.data || [])
            .filter(item => item.subject && item.subject.includes('營業收入資訊'))
            .slice(0, 10); // 每次處理前10筆避免被封

        const revenues = [];
        for (const item of revAnnouncements) {
            console.log(`正在處理: ${item.companyAbbreviation} (${item.companyId})`);
            try {
                // 這裡模擬 n8n 的 POST 請求，直接請求詳情內容
                const detailRes = await axios.post(item.url, new URLSearchParams({
                    step: '1',
                    firstin: 'true',
                    off: '1',
                    isnew: 'true',
                    co_id: item.companyId,
                    year: new Date().getFullYear() - 1911,
                    month: String(new Date().getMonth()).padStart(2, '0') // 取上個月
                }).toString(), { 
                    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
                    responseType: 'text'
                });

                const parsed = parseRevenueHtml(detailRes.data);
                if (parsed.name) {
                    revenues.push(parsed);
                }
                // 延遲一下，禮貌爬取
                await new Promise(r => setTimeout(r, 1500));
            } catch (err) {
                console.error(`${item.companyId} 抓取詳情失敗`);
            }
        }

        // 排序：按增幅百分比從大到小
        revenues.sort((a, b) => parseFloat(b.growth) - parseFloat(a.growth));

        // 寫入文件
        fs.writeFileSync(path.join(dataDir, 'announcements.json'), JSON.stringify(announcements, null, 2));
        fs.writeFileSync(path.join(dataDir, 'revenue.json'), JSON.stringify(revenues.length > 0 ? revenues : [{name:"今日暫無營收更新", id:"-", revenue:"-", growth:"0%"}], null, 2));
        
        console.log(`完成！抓取公告: ${announcements.length} 條，營收詳情: ${revenues.length} 條。`);
    } catch (error) {
        console.error('執行出錯:', error.message);
    }
}

run();
