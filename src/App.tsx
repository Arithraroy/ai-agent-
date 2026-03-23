/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Mic, Send, Volume2, VolumeX, GraduationCap, Loader2, User, Bot, History, MessageSquare } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { generateResponse, generateSpeech } from './lib/gemini';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  audioData?: string;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isConversationMode, setIsConversationMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<AudioBufferSourceNode | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    // Initialize Speech Recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'bn-BD';

      recognitionRef.current.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript) {
          setInput(finalTranscript);
          setIsListening(false);
          handleSend(finalTranscript);
        } else if (interimTranscript) {
          setInput(interimTranscript);
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        
        if (event.error === 'network') {
          setError('Network error: Speech recognition service is unreachable. Please check your connection.');
        } else if (event.error === 'not-allowed') {
          setError('Microphone access denied. Please enable permissions.');
        } else if (event.error === 'no-speech') {
          // Ignore no-speech errors to avoid cluttering UI
        } else {
          setError(`Speech recognition error: ${event.error}`);
        }

        if (isConversationMode && event.error !== 'not-allowed') {
          // If error occurs in conversation mode, try listening again after a short delay
          setTimeout(() => {
            if (isConversationMode && !isSpeaking) {
              setIsListening(true);
              try {
                recognitionRef.current?.start();
              } catch (e) {
                console.error('Failed to restart recognition:', e);
              }
            }
          }, 2000); // Longer delay for network errors
        }
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, [isConversationMode, isSpeaking]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text: string = input) => {
    if (!text.trim()) return;

    const userMessage: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const history = messagesRef.current.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }));

      const responseText = await generateResponse(text, history);
      const assistantMessage: Message = { role: 'assistant', content: responseText || 'I apologize, but I am unable to provide an answer at this time.' };

      setMessages(prev => [...prev, assistantMessage]);

      if (autoSpeak && responseText) {
        const audioData = await generateSpeech(responseText);
        if (audioData) {
          assistantMessage.audioData = audioData;
          // Update the message with audio data
          setMessages(prev => {
            const newMessages = [...prev];
            newMessages[newMessages.length - 1] = assistantMessage;
            return newMessages;
          });
          playAudio(audioData);
        }
      }
    } catch (error) {
      console.error('Error generating response:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: 'An error occurred while processing your request. Please try again.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const playAudio = async (base64Data: string) => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const audioBuffer = audioCtx.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      if (audioRef.current) {
        audioRef.current.stop();
      }

      const source = audioCtx.createBufferSource();
      audioRef.current = source;
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      
      source.onended = () => {
        setIsSpeaking(false);
        if (isConversationMode) {
          setTimeout(() => {
            setIsListening(true);
            recognitionRef.current?.start();
          }, 500);
        }
      };
      setIsSpeaking(true);
      source.start();
    } catch (error) {
      console.error('Error playing PCM audio:', error);
      setIsSpeaking(false);
    }
  };

  const toggleListening = () => {
    setError(null);
    if (isListening) {
      recognitionRef.current?.stop();
      setIsConversationMode(false);
    } else {
      setIsListening(true);
      recognitionRef.current?.start();
    }
  };

  const toggleConversationMode = () => {
    setError(null);
    if (isConversationMode) {
      setIsConversationMode(false);
      recognitionRef.current?.stop();
    } else {
      setIsConversationMode(true);
      setAutoSpeak(true);
      if (!isSpeaking && !isLoading) {
        setIsListening(true);
        recognitionRef.current?.start();
      }
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto bg-white shadow-2xl overflow-hidden border-x border-slate-200">
      {/* Header */}
      <header className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-lg">
            <GraduationCap size={28} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Profx</h1>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-widest italic">Theoretical Physics & Pure Math</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleConversationMode}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full font-bold text-[10px] uppercase tracking-widest transition-all duration-300 shadow-sm border",
              isConversationMode 
                ? "bg-red-500 text-white border-red-500 animate-pulse" 
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            )}
          >
            <MessageSquare size={14} />
            {isConversationMode ? "End Session" : "Start Session"}
          </button>
          <button
            onClick={() => setAutoSpeak(!autoSpeak)}
            className={cn(
              "p-2.5 rounded-full transition-all duration-300",
              autoSpeak ? "bg-slate-900 text-white shadow-md" : "bg-slate-100 text-slate-400 hover:bg-slate-200"
            )}
            title={autoSpeak ? "Auto-speak enabled" : "Auto-speak disabled"}
          >
            {autoSpeak ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          <button 
            onClick={() => setMessages([])}
            className="p-2.5 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 transition-all duration-300"
            title="Clear History"
          >
            <History size={20} />
          </button>
        </div>
      </header>

      {/* Error Banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-red-50 text-red-600 px-6 py-2 text-xs font-medium border-b border-red-100 flex justify-between items-center"
          >
            <span>{error}</span>
            <button onClick={() => setError(null)} className="hover:text-red-800 font-bold">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-6 opacity-60 py-12">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 border border-slate-100">
              <Bot size={40} />
            </div>
            <div className="max-w-md space-y-2">
              <h2 className="text-2xl font-serif italic text-slate-800">Welcome, Scholar.</h2>
              <p className="text-slate-500 text-sm leading-relaxed">
                I am Profx. I hold dual PhDs in Theoretical Physics and Pure Mathematics. 
                How may I assist your academic journey today?
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full max-w-lg">
              {['Explain Maxwell\'s Equations', 'Derive Schrodinger Equation', 'What is a Hilbert Space?', 'Explain Riemann Hypothesis'].map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="p-3 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-100 rounded-lg hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-all duration-300 text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((message, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex gap-4 max-w-[85%]",
                message.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
              )}
            >
              <div className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 shadow-sm",
                message.role === 'user' ? "bg-slate-100 text-slate-600" : "bg-slate-900 text-white"
              )}>
                {message.role === 'user' ? <User size={18} /> : <GraduationCap size={18} />}
              </div>
              <div className={cn(
                "space-y-2 p-5 rounded-2xl shadow-sm border",
                message.role === 'user' 
                  ? "bg-slate-50 border-slate-100 text-slate-800 rounded-tr-none" 
                  : "bg-white border-slate-100 text-slate-900 rounded-tl-none"
              )}>
                <div className="prose prose-slate max-w-none prose-sm prose-headings:font-serif prose-headings:italic">
                  <ReactMarkdown
                    remarkPlugins={[remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      p: ({ children }) => <p className="mb-4 last:mb-0 leading-relaxed">{children}</p>,
                      h1: ({ children }) => <h1 className="text-lg font-bold mt-6 mb-2">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-md font-bold mt-4 mb-2">{children}</h2>,
                      ol: ({ children }) => <ol className="list-decimal pl-5 space-y-2 mb-4">{children}</ol>,
                      ul: ({ children }) => <ul className="list-disc pl-5 space-y-2 mb-4">{children}</ul>,
                      li: ({ children }) => <li className="text-slate-700">{children}</li>,
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
                {message.audioData && (
                  <button
                    onClick={() => playAudio(message.audioData!)}
                    className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-colors mt-4"
                  >
                    <Volume2 size={14} />
                    Replay Explanation
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && (
          <div className="flex gap-4 max-w-[85%] mr-auto">
            <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0 animate-pulse">
              <GraduationCap size={18} />
            </div>
            <div className="bg-white border border-slate-100 p-5 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-3">
              <Loader2 className="animate-spin text-slate-400" size={18} />
              <span className="text-xs font-medium text-slate-400 italic">Professor is thinking...</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </main>

      {/* Input Area */}
      <footer className="p-6 bg-slate-50/50 border-t border-slate-100">
        <div className="relative flex items-center gap-3">
          <button
            onClick={toggleListening}
            className={cn(
              "p-4 rounded-xl transition-all duration-300 shadow-sm",
              isListening ? "bg-red-500 text-white animate-pulse" : "bg-white text-slate-400 hover:text-slate-900 border border-slate-200"
            )}
            title={isListening ? "Listening..." : "Voice Input"}
          >
            <Mic size={22} />
          </button>
          <div className="flex-1 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask about Physics or Mathematics..."
              className="w-full p-4 pr-14 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/5 focus:border-slate-900 transition-all shadow-sm text-slate-800 placeholder:text-slate-400"
            />
            <button
              onClick={() => handleSend()}
              disabled={isLoading || !input.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 text-slate-400 hover:text-slate-900 disabled:opacity-30 transition-colors"
            >
              <Send size={20} />
            </button>
          </div>
        </div>
        <p className="text-[10px] text-center mt-4 text-slate-400 font-medium uppercase tracking-widest">
          PhD Level Rigor • Bilingual Support • Voice Enabled
        </p>
      </footer>

      {/* Audio Visualizer Overlay (Optional) */}
      {isSpeaking && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-2xl z-50">
          {[1, 2, 3, 4, 5].map((i) => (
            <motion.div
              key={i}
              animate={{ height: [8, 16, 8] }}
              transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
              className="w-1 bg-white rounded-full"
            />
          ))}
          <span className="text-[10px] font-bold text-white uppercase tracking-widest ml-2">Professor Speaking</span>
        </div>
      )}
    </div>
  );
}
