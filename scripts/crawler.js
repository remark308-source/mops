const axios = require('axios');
const fs = require('fs');
const path = require('path');

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    'Origin': 'https://mops.twse.com.tw',
    'Referer': 'https://mops.twse.com.tw/mops/'
};

/**
 * 同步 n8n 的解析邏輯，包含備註抓取
 */
function parseRevenueHtml(html) {
    let result = { name: "", id: "", revenue: "", growth: "", note: "" };
    if (!html) return result;

    const idMatch = html.match(new RegExp("name='compID'\\s*value='(\\d+)'", "i"));
    result.id = idMatch ? idMatch[1] : "";

    const nameMatch = html.match(new RegExp("本資料由\\s*\\(.*?\\)\\s*([^\\s ]+)", ""));
    result.name = nameMatch ? nameMatch[1].trim() : "";

    const tableMatch = html.match(new RegExp("<TABLE[^>]*class='hasBorder'[^>]*>([\\s\\S]*?)<\\/TABLE>", "i"));
    if (tableMatch) {
        const tableContent = tableMatch[1];
        const fetchValue = (label, content) => {
            const regex = new RegExp(label + "[\\s\\S]*?<TD[^>]*>([\\s\\S]*?)<\\/TD>", "i");
            const match = content.match(regex);
            return match ? match[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim() : '';
        };

        result.revenue = fetchValue('本月', tableContent);
        const parts = tableContent.split(/本年累計/i);
        result.growth = fetchValue('增減百分比', parts[0]) + "%";

        // 抓取備註/原因說明
        const noteMatch = tableContent.match(new RegExp("(?:備註|原因說明)[\\s\\S]*?<TD[^>]*>([\\s\\S]*?)<\\/TD>", "i"));
        result.note = noteMatch ? noteMatch[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim() : '';
    }
    return result;
}

async function run() {
    const dataDir = path.join(__dirname, '../docs/data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const revPath = path.join(dataDir, 'revenue.json');
    const annPath = path.join(dataDir, 'announcements.json');

    try {
        // 1. 公告抓取
        const annRes = await axios.post('https://mops.twse.com.tw/mops/api/home_page/t05sr01_1', { count: "0", marketKind: "" }, { headers });
        const announcements = (annRes.data?.result?.data || [])
            .filter(item => ['自結', '財務業務', '營收'].some(k => item.subject.includes(k)))
            .map(i => ({ name: i.companyAbbreviation, id: i.companyId, date: i.date, subject: i.subject }));
        fs.writeFileSync(annPath, JSON.stringify(announcements, null, 2));

        // 2. 營收抓取與合併
        const revListRes = await axios.post('https://mops.twse.com.tw/mops/api/t51sb10', { count: "0", marketKind: "" }, { headers });
        const revAnnouncements = (revListRes.data?.result?.data || [])
            .filter(row => row.subject && row.subject.trim().endsWith('營業收入資訊')).slice(0, 15);

        let existingRevenue = [];
        if (fs.existsSync(revPath)) {
            try { existingRevenue = JSON.parse(fs.readFileSync(revPath)); } catch(e) {}
        }

        const newRevenues = [];
        const now = new Date();
        let targetYear = now.getFullYear() - 1911;
        let targetMonth = now.getMonth(); 
        if (targetMonth === 0) { targetMonth = 12; targetYear--; }

        for (const item of revAnnouncements) {
            console.log(`處理: ${item.companyAbbreviation}`);
            try {
                const params = new URLSearchParams({ step: '1', firstin: 'true', off: '1', isnew: 'true', co_id: item.companyId, year: targetYear.toString(), month: String(targetMonth).padStart(2, '0') });
                const detailRes = await axios.post('https://mopsov.twse.com.tw/mops/web/ajax_t05st10_ifrs', params.toString(), { 
                    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://mopsov.twse.com.tw/mops/web/t05st10_ifrs' },
                    responseType: 'text', timeout: 25000
                });
                const parsed = parseRevenueHtml(detailRes.data);
                if (parsed.name) newRevenues.push(parsed);
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {}
        }

        const combined = [...newRevenues, ...existingRevenue];
        const uniqueMap = new Map();
        combined.forEach(item => { if (!uniqueMap.has(item.id)) uniqueMap.set(item.id, item); });
        
        fs.writeFileSync(revPath, JSON.stringify(Array.from(uniqueMap.values()), null, 2));
        console.log('任務完成');
    } catch (error) { console.error('出錯:', error.message); }
}
run();
