#!/bin/bash
cat << 'INNER_EOF' > /tmp/getLocalTime.js
export const getKnownUtcOffset = (office) => {
    if (!office) return 0;
    const o = office.toLowerCase();
    if (o.includes('san francisco') || o.includes('palo alto') || o.includes('california')) return -8;
    if (o.includes('chicago')) return -6;
    if (o.includes('new york') || o.includes('atlanta')) return -5;
    if (o.includes('mexico')) return -6;
    if (o.includes('sao paulo') || o.includes('brazil')) return -3;
    if (o.includes('london')) return 0;
    if (o.includes('amsterdam') || o.includes('barcelona') || o.includes('frankfurt') || o.includes('oslo') || o.includes('germany') || o.includes('france') || o.includes('spain')) return 1;
    if (o.includes('south africa')) return 2;
    if (o.includes('dubai') || o.includes('uae')) return 4;
    if (o.includes('india') || o.includes('mumbai') || o.includes('delhi')) return 5.5;
    if (o.includes('singapore') || o.includes('manila') || o.includes('perth')) return 8;
    if (o.includes('sydney') || o.includes('melbourne')) return 10;
    if (o.includes('tokyo') || o.includes('seoul')) return 9;
    return 0; // Default
};

export const getLocalTimeStr = (scheduleStr, assignedPersonOffice) => {
    const match = scheduleStr.match(/(\d+):00 UTC/);
    if (!assignedPersonOffice || !match) return '';
    
    const utcHour = parseInt(match[1], 10);
    const offset = getKnownUtcOffset(assignedPersonOffice);
    let localHour = utcHour + offset;
    
    if (localHour < 0) localHour += 24;
    if (localHour >= 24) localHour -= 24;
    
    const isHalf = localHour % 1 > 0;
    const h = Math.floor(localHour).toString().padStart(2, '0');
    const m = isHalf ? '30' : '00';
    return `${h}:${m} Local`;
};
INNER_EOF
