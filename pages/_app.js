'use client';
import { useContext } from 'react';
import Head from 'next/head';
import { useState, useEffect } from "react";
import { TituloProvider, TituloContext } from '../contexts/TituloContext';
import Footer from '../components/ui/Footer';
import { useRouter } from 'next/router';
import useAuth from '../hooks/useAuth';
import { usePathname } from 'next/navigation';
import { PermissionProvider } from '../contexts/PermissionProvider';
import { AuthProvider } from '../contexts/AuthProvider';
import { ColorProvider } from '../contexts/ColorProvider';
import useColor from '../hooks/useColor';
import { getTextColor } from '../functions/colors';

import '../styles/global.css';
import '../styles/graficos.css';
import '../styles/botoes.css';
import '../styles/tabela.css';
import { ToolbarProvider } from '../contexts/ToolbarContext';
import { Toolbar } from '../components/ui/Toolbar/Toolbar';

function AuthGuard({ children }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [isMounted, setIsMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (window.location.hash && window.location.pathname === '/reset_password') {
      sessionStorage.setItem('supabaseHash', window.location.hash)
    }
  }, [])

  useEffect(() => {
    if (pathname != "/create_user" && !loading && isMounted && !user) {
      router.replace('/login');
    }

  }, [loading, isMounted, user]);

  if (!isMounted || loading) {
    return null;
  }

  return children;
}

function MyApp({ Component, pageProps }) {
  const router = useRouter();

  const isPublicPage = Component.isPublic || router.pathname.startsWith('/preview');

  return (
    <AuthProvider>
      <PermissionProvider>
        {isPublicPage ? (
          <PublicApp Component={Component} pageProps={pageProps} />
        ) : (
          <TituloProvider>
            <ColorProvider>
              <AuthGuard>
                <ToolbarProvider>
                  <InnerApp Component={Component} pageProps={pageProps} />
                </ToolbarProvider>
              </AuthGuard>
            </ColorProvider>
          </TituloProvider>
        )}
      </PermissionProvider>
    </AuthProvider>
  );
}

function PublicApp({ Component, pageProps }) {
  return (
    <div>
      <Head>
        <title>SM - Gantt</title>
        <link rel="icon" href="/images/logo.png" />
      </Head>
      <Component {...pageProps} />
      <Footer />
    </div>
  );
}

function InnerApp({ Component, pageProps }) {
  const { titulo } = useContext(TituloContext);
  const { colors } = useColor();
  const title = `${titulo ? 'SM | ' + titulo : 'STEM Management'}`

  useEffect(() => {
    if (colors) {
      document.documentElement.style.setProperty('--main-color', colors?.main || '#f28c28')
      document.documentElement.style.setProperty('--secondary-color', colors?.secondary || "#a0a0a0")
      document.documentElement.style.setProperty('--table-header-color', colors?.table_header || '#dadada')
      document.documentElement.style.setProperty('--table-header-text-color', colors?.table_header ? getTextColor(colors?.table_header) : 'black')
      document.documentElement.style.setProperty('--main-text-color', colors?.main ? getTextColor(colors?.main) : 'black')
      document.documentElement.style.setProperty('--main-text-hover-color', colors?.main ? (getTextColor(colors?.main) === 'white' ? 'black' : 'white') : 'black')
      document.documentElement.style.setProperty('--secondary-text-color', colors?.secondary ? getTextColor(colors?.secondary) : 'white')
    }
  }, [colors])

  return (
    <div>
      <Head>
        <title>{title}</title>
        <link rel="icon" href="/images/logo.png" />
      </Head>
      <Toolbar />
      <Component {...pageProps} />
      <Footer />
    </div>
  );
}

export default MyApp;
