import { useMemo, useState } from 'react'
import './SocialShareButtons.css'

interface SocialShareButtonsProps {
  title?: string
  text?: string
  url?: string
}

export default function SocialShareButtons({
  title = 'Meritocracy DAO',
  text = 'Funding scientists and open-source developers through transparent governance.',
  url,
}: SocialShareButtonsProps) {
  const [copied, setCopied] = useState(false)
  const shareUrl = useMemo(() => url || window.location.href, [url])
  const encodedUrl = encodeURIComponent(shareUrl)
  const encodedText = encodeURIComponent(text)
  const encodedTitle = encodeURIComponent(title)

  const links = [
    { label: 'X', href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}` },
    { label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}` },
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}` },
    { label: 'Reddit', href: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}` },
    { label: 'Email', href: `mailto:?subject=${encodedTitle}&body=${encodedText}%0A%0A${encodedUrl}` },
  ]

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy share link:', error)
    }
  }

  return (
    <section className="social-share-card" aria-label="Share Meritocracy">
      <p className="social-share-title">Share Meritocracy</p>
      <div className="social-share-list">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="social-share-link"
          >
            {link.label}
          </a>
        ))}
        <button type="button" className="social-share-copy" onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy Link'}
        </button>
      </div>
    </section>
  )
}
