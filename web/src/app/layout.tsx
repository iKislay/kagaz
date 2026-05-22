import type { Metadata } from 'next'
import { Archivo_Black, Space_Grotesk, Space_Mono } from 'next/font/google'
import './globals.css'

const fontDisplay = Archivo_Black({
  weight: '400',
  variable: '--font-display',
  subsets: ['latin'],
})

const fontSans = Space_Grotesk({
  variable: '--font-sans',
  subsets: ['latin'],
})

const fontMono = Space_Mono({
  weight: ['400', '700'],
  variable: '--font-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'KAGAZ - Print Anywhere',
  description: 'Upload your documents and print at a nearby kiosk',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-canvas text-white flex flex-col font-sans">{children}</body>
    </html>
  )
}
