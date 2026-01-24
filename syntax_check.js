const fs = require('fs');

try {
    const content = fs.readFileSync('script.js', 'utf8');
    const lines = content.split('\n');
    
    let braces = 0;
    let braceStack = [];
    
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        
        for (let charPos = 0; charPos < line.length; charPos++) {
            const char = line[charPos];
            
            if (char === '{') {
                braces++;
                braceStack.push({ line: lineNum + 1, char: charPos + 1, content: line.trim() });
            } else if (char === '}') {
                braces--;
                if (braceStack.length > 0) {
                    braceStack.pop();
                }
                
                if (braces < 0) {
                    console.log(`錯誤：第 ${lineNum + 1} 行第 ${charPos + 1} 字符處有多餘的閉合大括號`);
                    console.log(`行內容: ${line.trim()}`);
                    break;
                }
            }
        }
    }
    
    console.log(`最終大括號平衡: ${braces}`);
    
    if (braces > 0) {
        console.log(`有 ${braces} 個未閉合的開大括號:`);
        console.log('未閉合的大括號位置:');
        braceStack.slice(-Math.min(5, braceStack.length)).forEach((brace, index) => {
            console.log(`${index + 1}. 第 ${brace.line} 行: ${brace.content}`);
        });
    } else if (braces === 0) {
        console.log('所有大括號都已正確閉合');
    }
    
} catch (error) {
    console.error('讀取文件錯誤:', error.message);
}