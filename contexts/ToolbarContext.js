'use client';
import { useRef } from 'react';
import { createContext, useContext, useState, ReactNode } from 'react';

export const ToolbarContext = createContext(undefined);

export const ToolbarProvider = ({ children }) => {
  const [helpClick, setHelpClick] = useState(null);
  const [exportCSVClick, setExportCSVClick] = useState(null);
  const [generatePreviewLink, setGeneratePreviewLink] = useState(null);

  return (
    <ToolbarContext.Provider value={{ helpClick, setHelpClick, exportCSVClick, setExportCSVClick, generatePreviewLink, setGeneratePreviewLink }}>
      {children}
    </ToolbarContext.Provider>
  );
}