import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { MessageCircle, X, Send, Sparkles, Loader2, Bot } from 'lucide-react';
import { MOCK_PRODUCTS, REVENUE_DATA, MOCK_ORDERS, formatCurrency } from '../constants';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

const AIChat: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', text: 'Xin chào! Tôi là trợ lý ảo OneBiz. Tôi có thể giúp gì cho bạn về số liệu kinh doanh hôm nay?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // If API key is not present, mock the response for demo purposes
      if (!process.env.API_KEY) {
        // Simple heuristic mock response logic for demo
        let mockResponse = "Tôi chưa được kết nối với API Key. Tuy nhiên, tôi có thể thấy bạn đang quan tâm đến dữ liệu ERP.";
        const lowerInput = userMsg.text.toLowerCase();
        
        if (lowerInput.includes('doanh thu') || lowerInput.includes('tiền')) {
           const totalRev = REVENUE_DATA.reduce((acc, curr) => acc + curr.value, 0);
           mockResponse = `Dựa trên dữ liệu biểu đồ, tổng doanh thu tuần này là ${formatCurrency(totalRev)}. Ngày cao nhất là Thứ 7.`;
        } else if (lowerInput.includes('tồn kho') || lowerInput.includes('sản phẩm')) {
           const lowStock = MOCK_PRODUCTS.filter(p => p.status === 'Low Stock' || p.status === 'Out of Stock');
           mockResponse = `Hiện tại có ${MOCK_PRODUCTS.length} sản phẩm trong kho. Cảnh báo: Có ${lowStock.length} sản phẩm sắp hết hoặc đã hết hàng cần nhập thêm.`;
        } else if (lowerInput.includes('đơn hàng')) {
           mockResponse = `Hệ thống ghi nhận ${MOCK_ORDERS.length} đơn hàng gần đây nhất. Đơn hàng lớn nhất trị giá ${formatCurrency(45000000)}.`;
        }

        setTimeout(() => {
          setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', text: mockResponse }]);
          setLoading(false);
        }, 1500);
        return;
      }

      // Real Gemini Implementation
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Context Engineering
      const context = `
        Bạn là trợ lý AI cho hệ thống ERP "OneBiz".
        Dữ liệu hiện tại:
        - Tổng sản phẩm: ${MOCK_PRODUCTS.length}
        - Sản phẩm tồn kho thấp: ${MOCK_PRODUCTS.filter(p => p.stock < 10).map(p => p.name).join(', ')}
        - Doanh thu tuần: ${JSON.stringify(REVENUE_DATA)}
        - Đơn hàng gần đây: ${JSON.stringify(MOCK_ORDERS.map(o => ({ id: o.id, total: o.total, status: o.status })))}
        
        Hãy trả lời ngắn gọn, chuyên nghiệp bằng tiếng Việt.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-latest', // Using a fast model for chat
        contents: [
          { role: 'user', parts: [{ text: `Context: ${context}\n\nUser Question: ${userMsg.text}` }] }
        ]
      });

      const text = response.text || "Xin lỗi, tôi không thể xử lý yêu cầu lúc này.";
      
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', text }]);
    } catch (error) {
      console.error("AI Error", error);
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', text: "Đã xảy ra lỗi khi kết nối với AI." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-20 lg:bottom-4 right-4 z-50 flex flex-col items-end transition-all duration-300">
      {/* Chat Window */}
      {isOpen && (
        <div className="mb-3 w-80 sm:w-96 bg-white dark:bg-slate-900 rounded-xl shadow-2xl shadow-indigo-500/10 border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col animate-in slide-in-from-bottom-5 duration-200">
          <div className="bg-white dark:bg-slate-900 p-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
            <div className="flex items-center gap-2">
               <div className="bg-indigo-50 dark:bg-indigo-900/30 p-1.5 rounded-lg">
                 <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
               </div>
               <div>
                 <h3 className="font-bold text-xs text-slate-900 dark:text-white">Trợ lý AI</h3>
                 <p className="text-[10px] text-slate-500 dark:text-slate-400">Powered by Gemini</p>
               </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="hover:bg-slate-100 dark:hover:bg-slate-800 p-1 rounded-md transition-colors text-slate-500">
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="h-72 bg-slate-50 dark:bg-slate-950 overflow-y-auto p-3 space-y-2.5">
             {messages.map((msg) => (
               <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                 {msg.role === 'assistant' && (
                   <div className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center mr-2 mt-0.5 shrink-0">
                     <Bot className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                   </div>
                 )}
                 <div className={`
                   max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed shadow-sm
                   ${msg.role === 'user' 
                     ? 'bg-indigo-600 text-white rounded-br-none' 
                     : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-800 rounded-bl-none'
                   }
                 `}>
                   {msg.text}
                 </div>
               </div>
             ))}
             {loading && (
               <div className="flex justify-start">
                  <div className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center mr-2 mt-0.5">
                     <Bot className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                   </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl rounded-bl-none px-3 py-2 shadow-sm">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                  </div>
               </div>
             )}
             <div ref={messagesEndRef} />
          </div>

          <div className="p-2.5 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-950 rounded-lg px-3 py-1.5 border border-slate-200 dark:border-slate-800 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all">
              <input 
                className="bg-transparent border-none outline-none text-xs w-full text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                placeholder="Hỏi về số liệu..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              />
              <button 
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 disabled:opacity-50 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toggle Button */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`
          group flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-full shadow-lg shadow-indigo-600/30 transition-all hover:scale-105 active:scale-95
          ${isOpen ? 'bg-slate-800 hover:bg-slate-900 shadow-slate-800/30' : ''}
        `}
      >
        {isOpen ? (
            <X className="w-5 h-5" />
        ) : (
            <>
              <MessageCircle className="w-5 h-5" />
              <span className="text-xs font-bold pr-1">Hỏi AI</span>
            </>
        )}
      </button>
    </div>
  );
};

export default AIChat;
