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
 * 核心解析函數：修正了正則表達式中的斜線轉義問題
 */
function parseRevenueHtml(html) {
    let result = { "公司名稱": "", "公司代號": "", "資料期間": "", "本月營收": "", "增減百分比": "", "備註": "" };
    
    if (!html) return result;

    const idMatch = html.match(/name='compID'\s*value='(\d+)'/i);
    result["公司代號"] = idMatch ? idMatch[1] : "";

    const nameMatch = html.match(/本資料由\s*\(.*?\)\s*([^\s ]+)/);
    result["公司名稱"] = nameMatch ? nameMatch[1].trim() : "";

    const periodMatch = html.match(/民國(\d+)年(\d+)月/);
    result["資料期間"] = periodMatch ? `民國${periodMatch[1]}年${periodMatch[2]}月` : "";

    // 修正點：使用 [\/] 或轉義 \/ 來避免正則表達式提前結束
    const tableMatch = html.match(/<TABLE[^>]*class='hasBorder'[^>]*>([\s\S]*?)<\/TABLE>/i);
    if (tableMatch) {
        const tableContent = tableMatch[1];
        
        const fetchValue = (label, content) => {
            // 轉義了 <\/TD>
            const regex = new RegExp(label + "[\\s\\S]*?<TD[^>]*>([\\s\\S]*?)<\\/TD>", "i");
            const match = content.match(regex);
            return match ? match[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim() : '';
        };

        result["本月營收"] = fetchValue('本月', tableContent);
        const parts = tableContent.split(/本年累計/i);
        const firstHalf = parts[0];
        result["增減百分比"] = fetchValue('增減百分比', firstHalf) + "%";

        // 修正點：轉義了 <\/TD>
        const noteMatch = tableContent.match(/(?:備註|原因說明)[\s\S]*?<TD[^>]*>([\s\S]*?)<\\/TD>/i);
        result["備註"] = noteMatch ? noteMatch[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim() : '';
    }

    return {
        name: result["公司名稱"] || "未知公司",
        id: result["公司代號"] || "-",
        revenue: result["本月營收"] || "N/A",
        growth: result["增減百分比"] || "0%",
        note: result["備註"] || ""
    };
}

async function run() {
    const dataDir = path.join(__dirname, '../docs/data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    try {
        console.log('1. 獲取公告列表...');
        const annRes = await axios.post('https://mops.twse.com.tw/mops/api/home_page/t05sr01_1', { count: "0", marketKind: "" }, { headers });
        const announcements = (annRes.data?.result?.data || [])
            .filter(item => ['自結', '財務業務', '營收'].some(k => item.subject.includes(k)))
            .slice(0, 10).map(i => ({ name: i.companyAbbreviation, id: i.companyId, date: i.date, subject: i.subject }));

        console.log('2. 獲取營收公告列表...');
        const revListRes = await axios.post('https://mops.twse.com.tw/mops/api/t51sb10', { count: "0", marketKind: "" }, { headers });
        const revAnnouncements = (revListRes.data?.result?.data || [])
            .filter(row => row.subject && row.subject.trim().endsWith('營業收入資訊')).slice(0, 10);

        const revenues = [];
        const now = new Date();
        let targetYear = now.getFullYear() - 1911;
        let targetMonth = now.getMonth(); 
        if (targetMonth === 0) { targetMonth = 12; targetYear--; }

        for (const item of revAnnouncements) {
            console.log(`處理中: ${item.companyAbbreviation} (${item.companyId})`);
            try {
                const params = new URLSearchParams({
                    step: '1', firstin: 'true', off: '1', isnew: 'true',
                    co_id: item.companyId, year: targetYear.toString(), month: String(targetMonth).padStart(2, '0')
                });
                
                const detailRes = await axios.post('https://mopsov.twse.com.tw/mops/web/ajax_t05st10_ifrs', params.toString(), { 
                    headers: { 
                        ...headers, 
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Referer': 'https://mopsov.twse.com.tw/mops/web/t05st10_ifrs' 
                    },
                    responseType: 'text', timeout: 20000
                });

                const parsed = parseRevenueHtml(detailRes.data);
                if (parsed.name && parsed.name !== "未知公司") revenues.push(parsed);
                await new Promise(r => setTimeout(r, 2500));
            } catch (err) { console.error(`${item.companyId} 抓取失敗`); }
        }

        revenues.sort((a, b) => parseFloat(b.growth) - parseFloat(a.growth));
        fs.writeFileSync(path.join(dataDir, 'announcements.json'), JSON.stringify(announcements, null, 2));
        fs.writeFileSync(path.join(dataDir, 'revenue.json'), JSON.stringify(revenues.length > 0 ? revenues : [{name:"今日暫無數據", id:"-", revenue:"-", growth:"0%"}], null, 2));
        console.log('任務成功完成');
    } catch (error) { console.error('出錯:', error.message); }
}
run();
