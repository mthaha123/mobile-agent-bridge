import React, { memo, useMemo, useRef } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import type { TextStyle, ViewStyle } from 'react-native'
import { Renderer, useMarkdown } from 'react-native-marked'
import { MarkdownTable } from './MarkdownTable'
import { MarkdownCodeBlock } from './MarkdownCodeBlock'
import { useThemeColors, useThemeMode } from '../../theme/ThemeContext'
import { MARKDOWN_ENGINE, type MarkdownEngine } from '../../config/markdownEngine'
import { NativeMarkdown } from './NativeMarkdown'

interface MarkdownRendererProps {
  content: string
}

/**
 * 瑕嗗啓榛樿 Renderer 鐨?table() 涓?code()锛?
 * - table()锛氬唴缃?MDTable 鍒楀鍥哄畾涓?43% 灞忓/鍒椾笖妯悜婊氬姩鍦?inverted FlatList +
 *   TouchableOpacity 鎵嬪娍鍗忓晢涓嬬粡甯稿け鏁堬紙琛ㄦ牸婧㈠嚭灞忓箷鍙堟粦涓嶅姩锛夈€?
 *   鏀圭敤 MarkdownTable锛氳嚜閫傚簲鍒楀 + 鍙潬妯悜婊氬姩 + 鍏ㄥ睆鏌ョ湅鍏滃簳銆?
 * - code()锛氬唴缃疄鐜版湭寮€ nestedScrollEnabled锛屽祵濂楁粴鍔ㄤ笅妯悜鎷栧姩澶辨晥銆?
 *   鏀圭敤 MarkdownCodeBlock锛歨orizontal ScrollView + nestedScrollEnabled + 婧㈠嚭妫€娴嬨€?
 */
/** 娓叉煋鍣ㄥ疄渚嬪簭鍙凤細淇濊瘉涓嶅悓 MarkdownRenderer 瀹炰緥鐨?key 鍛藉悕绌洪棿浜掍笉鍐茬獊 */
let rendererSeq = 0

export class TableAwareRenderer extends Renderer {
  private readonly uid = `md${++rendererSeq}`
  private keySeq = 0

  /** 姣忔閲嶆柊瑙ｆ瀽鍓嶅綊闆讹細浣嶇疆閿粠 0 璧凤紝鍚屼竴鏂囨。浣嶇疆鐨?key 璺ㄦ覆鏌撶ǔ瀹?*/
  resetKeys(): void {
    this.keySeq = 0
  }

  /**
   * 瑕嗙洊鍩虹被 getKey()銆?
   *
   * 鍩虹被瀹炵幇鏄?`this.slugger.slug('react-native-marked-ele')`鈥斺€攇ithub-slugger
   * 鍗曡皟閫掑涓?*姘镐笉閲嶇疆**锛屼簬鏄瘡娆￠噸鏂拌В鏋愶紙娴佸紡姣?80ms 涓€娆★級閮戒骇鍑哄叏鏂扮殑 key銆?
   * React 鎸?key 瀵归綈瀛愯妭鐐癸紝key 鍏ㄥ彉 鈬?鏁存５ markdown 瀛愭爲琚垽瀹氫负"鍏ㄩ儴鍒犻櫎 +
   * 鍏ㄩ儴鏂板缓"锛孎abric 鎶婃瘡涓妭鐐归噸鏂?create + measure + layout銆?
   *
   * 瀹炴祴锛圓ndroid 妯℃嫙鍣?/ 30k 瀛楃闀挎枃 / 娴佸紡 12.5 娆￠噸娓叉煋姣忕锛夛細
   *   涓荤嚎绋嬪崱姝诲湪 View.<init> 鈫?ViewGroup.resolveLayoutParams 鈫?View.measure
   *   锛坉ebuggerd 瀹炴媿鏍堬級锛孋PU 鎵撴弧 鈫?鐐瑰嚮鏃犲搷搴斻€佸彧鑳芥粴鍔紱
   *   鍚屾椂 slugger 鍐呴儴 Set 鏃犵晫澧為暱锛圧ES 姣忓垎閽熸定鏁板崄 MB锛夈€?
   *
   * 鏀逛负"鍗曟瑙ｆ瀽鍐呰嚜澧炵殑浣嶇疆閿?锛氬悓涓€鏂囨。鍓嶇紑璺ㄦ覆鏌?key 绋冲畾锛孎abric 鍙渶 diff
   * 鍙樺寲閮ㄥ垎锛堟祦寮忚拷鍔犳椂鍙湁灏鹃儴鑺傜偣閲嶅缓锛夛紝骞堕『甯︽秷闄?slugger 鐨勫唴瀛樻硠婕忋€?
   */
  getKey(): string {
    return `${this.uid}-${this.keySeq++}`
  }

  code(
    text: string,
    _language?: string,
    containerStyle?: ViewStyle,
    textStyle?: TextStyle,
  ): React.ReactNode {
    return (
      <MarkdownCodeBlock
        key={this.getKey()}
        text={text}
        containerStyle={containerStyle}
        textStyle={textStyle}
      />
    )
  }

  table(header: React.ReactNode[][], rows: React.ReactNode[][][]): React.ReactNode {
    return <MarkdownTable key={this.getKey()} header={header} rows={rows} />
  }
}

// 鈹€鈹€鈹€ 娴佸紡澧為噺瑙ｆ瀽锛氱ǔ瀹氬墠缂€ + 澧為暱灏鹃儴 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * 鍓嶇紑鏈熬鑻ユ槸鍒楄〃椤?/ 寮曠敤 / 缂╄繘缁锛屽湪姝ゅ垏鍒嗕細鎶婁竴涓潡鎷嗘垚涓や釜鍧?
 * 锛堟澗鍒楄〃鈫旂揣鍒楄〃銆佸紩鐢ㄥ潡鍒嗚绛夛級鈫?娓叉煋缁撴灉涓庢暣绡囪В鏋愪笉涓€鑷达紝璺宠繃銆?
 */
function isContinuationish(line: string): boolean {
  return (
    /^\s*([-*+]|\d+[.)])\s/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s{2,}\S/.test(line)
  )
}

/**
 * 鎵惧嚭鍐呭涓渶鍚庝竴涓€屽畨鍏ㄥ潡杈圭晫銆嶏紝杩斿洖 { stable, tail }锛?
 * stable 涓哄彲鍐荤粨鍓嶇紑锛堝惈杈圭晫澶勭┖琛岋級锛宼ail 涓哄皻鍦ㄥ闀裤€佹瘡涓?flush 閮借閲嶈В鏋愮殑灏鹃儴銆?
 *
 * 鍒囧垎鐐瑰繀椤昏惤鍦ㄣ€屽潡杈圭晫銆嶄笖**涓嶇牬鍧?markdown 璇箟**锛?
 *   - 鍙湪绌鸿锛圽n\n锛夊鍒囷紱
 *   - 鍓嶇紑閲屼唬鐮佸洿鏍忓繀椤婚棴鍚堬紙鍚﹀垯浼氭妸鍥存爮鍐呯殑绌鸿褰撳潡杈圭晫锛夛紱
 *   - 鍓嶇紑鏈€鍚庝竴琛屼笉鑳芥槸鍒楄〃椤?寮曠敤/缂╄繘缁锛堝惁鍒欎細鎷嗘暎鍚屼竴涓潡锛夈€?
 * 鎵句笉鍒板畨鍏ㄥ垏鍒嗙偣鏃惰繑鍥?stable=''锛岄€€鍖栦负鏁寸瘒瑙ｆ瀽锛堜笌鍘熻涓轰竴鑷达紝涓嶄細鏇村樊锛夈€?
 */
export function splitStablePrefix(content: string): { stable: string; tail: string; openFenceAtEnd: boolean } {
  // 鍗曡稛鎵弿锛圤(n)锛夛細娴佸紡姣忎釜 flush 閮戒細璋冪敤锛屼笉鑳藉湪鍊欓€夎竟鐣屼笂鍙嶅鍒囧垎鏁翠釜鍓嶇紑
  // 锛堝垪琛?寮曠敤瀵嗛泦鐨勯暱鏂囦細璁?O(n虏) 閫€鍖栨垚姣忕鏁扮櫨 ms 鐨勭函寮€閿€锛夈€?
  let offset = 0
  let openFence: string | null = null
  let prevNonBlank = ''
  let lastSafe = 0

  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineEnd = Math.min(offset + line.length + 1, content.length)
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      const marker = fence[1][0]
      if (openFence === null) openFence = marker
      else if (openFence === marker) openFence = null
    } else if (
      line.trim() === '' &&
      openFence === null &&
      prevNonBlank !== '' &&
      !isContinuationish(prevNonBlank)
    ) {
      // 绌鸿 + 鍥存爮宸查棴鍚?+ 鍓嶄竴涓潪绌鸿涓嶆槸缁 鈫?姝ゅ鏄畨鍏ㄥ潡杈圭晫
      lastSafe = lineEnd
    }
    if (line.trim() !== '') prevNonBlank = line
    offset = offset + line.length + 1
  }

  const openFenceAtEnd = openFence !== null
  if (lastSafe <= 0) {
    // 鏃犲彲鍐荤粨鍓嶇紑 鈫?鏁寸瘒浜ょ粰灏鹃儴瑙ｆ瀽锛堜笌鍘熻涓轰竴鑷达紝涓嶄細鏇村樊锛?
    return { stable: '', tail: content, openFenceAtEnd }
  }
  return { stable: content.slice(0, lastSafe), tail: content.slice(lastSafe), openFenceAtEnd }
}

// 鈹€鈹€鈹€ 缁勪欢 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * 鍐荤粨鍧楋細text 涓嶅彉鍒?*姘镐笉閲嶈В鏋?*锛坢emo 鎸′綇鐖剁骇閲嶆覆鏌?+ useMarkdown 浠?value
 * 涓?memo 渚濊禆锛夈€傛祦寮忔湡闂村彧鏈夈€屽熬閮ㄥ潡銆嶇殑 text 浼氬彉銆?
 */
const MarkdownChunk: React.FC<{ text: string }> = memo(({ text }) => {
  const colors = useThemeColors()
  const mode = useThemeMode()

  // 鈿狅笍 theme 蹇呴』璺ㄦ覆鏌撲繚鎸佸紩鐢ㄧǔ瀹氾細react-native-marked 鐨?useMarkdown 鍐呴儴浠?
  // [styles, theme, colorScheme] 涓?memo 渚濊禆锛岃鍐呮柊寤?theme 浼氳 styles/parser/
  // elements 涓夌骇 memo 鍏ㄩ儴澶辨晥 鈥斺€?鍗充娇 content 瀹屽叏娌″彉锛屾瘡娆＄埗绾ч噸娓叉煋浠嶄細瀵?
  // 鏁寸瘒 markdown 閲嶆柊 lex + parse銆?
  const theme = useMemo(
    () => ({
      colors: {
        code: colors.markdownCodeBg,
        link: colors.markdownLink,
        text: colors.markdownText,
        border: colors.markdownBorder,
      },
      spacing: {},
    }),
    [colors.markdownCodeBg, colors.markdownLink, colors.markdownText, colors.markdownBorder],
  )

  // 姣忎釜鍧楃嫭绔?renderer 瀹炰緥锛氬潡涔嬮棿鏄厔寮熻妭鐐癸紝key 鍛藉悕绌洪棿蹇呴』闅旂
  const renderer = useMemo(() => new TableAwareRenderer(), [])

  let elements: React.ReactNode[] | null = null
  let failed = false
  try {
    // 瑙ｆ瀽鍓嶆妸浣嶇疆閿綊闆讹紙璇﹁ TableAwareRenderer.getKey 娉ㄩ噴锛?
    renderer.resetKeys()
    elements = useMarkdown(text, {
      theme: theme as any,
      colorScheme: mode as any,
      renderer,
    })
  } catch {
    failed = true
  }

  if (failed || elements === null) {
    return <Text style={[styles.fallback, { color: colors.markdownText }]}>{text}</Text>
  }
  return <>{elements}</>
})

/**
 * 灏鹃儴鏄惁涓恒€屾湭闂悎浠ｇ爜鍥存爮銆嶏細鏄垯璺宠繃 markdown 瑙ｆ瀽锛岀洿鎺ユ寜浠ｇ爜鍧楁覆鏌撱€?
 * 鍙湪 tail 浠ュ洿鏍忓紑澶存椂鎴愮珛锛堝惁鍒欏熬閮ㄨ繕鍚叾瀹冩湭瀹屾垚鍧楋紝浜ょ粰 MarkdownChunk 姝ｅ父瑙ｆ瀽锛夈€?
 */
export function isOpenFenceTail(tail: string): boolean {
  return /^\s*(`{3,}|~{3,})/.test(tail)
}

/**
 * 娴佸紡銆屾湭闂悎浠ｇ爜鍥存爮銆嶇殑灏鹃儴娓叉煋銆?
 *
 * 鑳屾櫙锛氬洿鏍忔湭闂悎鏃?`splitStablePrefix` 鎵句笉鍒板畨鍏ㄥ潡杈圭晫锛堝潡璇箟瑕佹眰鍥存爮闂悎锛夛紝
 * 浜庢槸 tail = 鏁存浠ｇ爜锛涜嫢璧?`useMarkdown`锛屾瘡涓?flush 閮戒細鎶婃暣娈典唬鐮?*鍏ㄩ噺閲嶈В鏋?*
 * 锛堝疄娴?16KB 鏂囨。锛歵ail 骞冲潎 8.3KB銆佹渶澶?16.6KB锛?07/208 娆?flush 閮藉湪閲嶈В鏋愶級銆?
 *
 * 杩欓噷鐩存帴鎶婄函鏂囨湰鎸変唬鐮佸潡鏍峰紡娓叉煋锛堝崟浠?Text銆佷笉瑙ｆ瀽锛夆€斺€?鎶娿€屾瘡娆?flush 鍏ㄩ噺瑙ｆ瀽銆?
 * 闄嶄负**闆惰В鏋?*銆傚洿鏍忎竴鏃﹂棴鍚堬紝杈圭晫鎺ㄨ繘 鈫?鏁村潡杩涘叆鍐荤粨鍧楄矾寰勶紝鐢?MarkdownChunk 瑙ｆ瀽涓€娆°€?
 */
export const StreamingCodeTail: React.FC<{ text: string }> = memo(({ text }) => {
  const colors = useThemeColors()
  // 鍘绘帀寮€澶寸殑鍥存爮琛岋紙鍚瑷€鏍囨敞锛夛紝鍙覆鏌撲唬鐮佹鏂?
  const m = /^[ \t]*(?:`{3,}|~{3,})[^\n]*\n?/.exec(text)
  const body = m ? text.slice(m[0].length) : text
  // 鍒绘剰涓嶇敤 MarkdownCodeBlock锛氬畠涓轰簡妯粴浼氶澶栨覆鏌撲竴涓殣钘忔帰閽堬紙鍚屼竴浠芥枃鏈覆鏌撲袱閬嶏級
  // 骞惰Е鍙?layout鈫抯etState锛屾祦寮忔湡闂村弽鑰屾洿璐点€傝繖閲屽彧娓叉煋涓€浠芥枃鏈紙闀胯鎹㈣锛夛紝
  // 鍥存爮闂悎鍚庤嚜鐒跺垏鍥炲甫妯粴鐨?MarkdownCodeBlock銆?
  return (
    <View testID="md-stream-code" style={[styles.streamCodeWrap, { backgroundColor: colors.markdownCodeBg }]}>
      <Text
        selectable={false}
        style={[styles.streamCodeText, { color: colors.markdownText }]}
      >
        {body}
      </Text>
    </View>
  )
})

/** 灏鹃儴鏄惁涓恒€屾棤 markdown 璇箟鐨勭函鏂囨湰銆嶏紙鏃犳崲琛屻€侀潪鍒楄〃椤广€佹棤鍏冨瓧绗︼級 */
export function isPlainTextTail(tail: string): boolean {
  if (tail.length === 0) return false
  if (tail.includes('\n')) return false
  if (/^\s*([-+]|\d+[.)])\s/.test(tail)) return false
  if (/^\s*-{3,}\s*$/.test(tail)) return false // 鍒嗛殧绾?---
  return !/[*_`~#>|[\]\\!&]/.test(tail)
}

/**
 * 绾枃鏈熬閮細鏃?markdown 璇箟 鈫?鐩存帴鍗曡妭鐐?Text 娓叉煋銆?
 * 缁撴灉涓庤В鏋愪竴鑷达紙绾枃鏈?markdown 涓嶆敼鍙樺瓧褰級锛屼絾鐪佹帀 useMarkdown 鐨勮В鏋愪笌鍏冪礌鏍戝紑閿€銆?
 */
export const PlainTextTail: React.FC<{ text: string }> = memo(({ text }) => {
  const colors = useThemeColors()
  return (
    <Text testID="md-plain-tail" style={[styles.plainTail, { color: colors.markdownText }]}>
      {text}
    </Text>
  )
})

/** 鍐荤粨鍧楃疮绉姸鎬侊細text = 宸插喕缁撴枃鏈紝chunks = 鎸夎竟鐣屽垏寮€鐨勫潡锛堝彧澧炰笉鏀癸級 */
export interface FrozenChunks {
  text: string
  chunks: string[]
}

/**
 * 鎶婃柊鐨勭ǔ瀹氬墠缂€绱Н鎴愬喕缁撳潡鍒楄〃銆?
 *
 * 鍏抽敭涓嶅彉閲忥細**宸蹭骇鍑虹殑鍧楁案涓嶆敼鍐?*锛堝惁鍒?useMarkdown 浼氶噸鏂拌В鏋愭暣绡?鈥斺€?瀹炴祴
 * 鍗曟 346ms锛夈€傝竟鐣屾帹杩涙椂鍙妸鏂板閮ㄥ垎浣滀负鏂板潡杩藉姞銆?
 * 鍐呭琚潈濞佸揩鐓ф浛鎹?鍥為€€锛坰table 涓嶅啀浠ュ凡鍐荤粨鏂囨湰涓哄墠缂€锛夋椂鏁寸粍閲嶅缓銆?
 */
export function accumulateChunks(prev: FrozenChunks, stable: string): FrozenChunks {
  if (!stable.startsWith(prev.text)) {
    return stable ? { text: stable, chunks: [stable] } : { text: '', chunks: [] }
  }
  if (stable.length === prev.text.length) return prev
  return { text: stable, chunks: [...prev.chunks, stable.slice(prev.text.length)] }
}

const MarkdownRendererInner: React.FC<MarkdownRendererProps> = ({ content }) => {
  const { stable, tail, openFenceAtEnd } = useMemo(() => splitStablePrefix(content), [content])
  // 鍐荤粨鍧楄法娓叉煋绱Н锛堝彧澧炰笉鏀癸紝瑙?accumulateChunks 涓嶅彉閲忥級
  const frozen = useRef<FrozenChunks>({ text: '', chunks: [] })
  const next = accumulateChunks(frozen.current, stable)
  if (next !== frozen.current) frozen.current = next
  const chunks = frozen.current.chunks

  return (
    <View>
      {chunks.map((c, i) => (
        <MarkdownChunk key={`c${i}`} text={c} />
      ))}
      {tail.length > 0 ? (
        openFenceAtEnd && isOpenFenceTail(tail)
          ? <StreamingCodeTail key="tail" text={tail} />
          : isPlainTextTail(tail)
            ? <PlainTextTail key="tail" text={tail} />
            : <MarkdownChunk key="tail" text={tail} />
      ) : null}
    </View>
  )
}

/**
 * 娴佸紡 markdown 娓叉煋鍣細鎶婂唴瀹瑰垏鎴愩€屽喕缁撳潡 + 灏鹃儴鍧椼€嶃€?
 *
 * 鑳屾櫙锛歚useMarkdown` 浠?content 涓?memo 渚濊禆 鈥斺€?娴佸紡鏈熼棿 content 姣忎釜 flush 閮藉彉锛?
 * 浜庢槸**鏁寸瘒** markdown锛堝疄娴?30k 瀛楃 / 1 涓囦釜 token 鑺傜偣锛夎閲嶆柊 lex + parse +
 * 閲嶅缓 React 鍏冪礌鏍戯紝姣忕 12.5 娆★紙80ms flush锛夈€侶ermes 涓婂崟娆″叏閲忚В鏋?60鈥?50ms
 * 锛堝疄娴?28.7k 瀛楃 = 346ms锛夛紝JS 绾跨▼闀挎湡 100%銆佷富绾跨▼琚?Fabric 鎸傝浇鎸囦护鎵撴弧 鈫?
 * 鐐瑰嚮鏃犲搷搴斻€佸彧鑳芥粴鍔紙瀹炴祴娴佸紡鏈熼棿鐐广€孎iles銆嶉〉绛炬棤鍙嶅簲锛夈€?
 *
 * 鏂规锛氭寜**瀹夊叏鍧楄竟鐣?*鎶婂凡鍐欏畬鐨勯儴鍒嗗垏鎴愯嫢骞层€屽喕缁撳潡銆嶏紝姣忓潡鍙В鏋愪竴娆″苟 memo
 * 浣忥紱鍙湁灏鹃儴锛堟渶鍚庝竴涓湭瀹屾垚鍧楋級姣忎釜 flush 閲嶆柊瑙ｆ瀽銆傚疄娴嬬湡瀹為暱鏂囷紙28.7k 瀛楃锛夛細
 * 灏鹃儴骞冲潎 219 瀛楃銆佹渶澶?902 瀛楃锛涚湡鏈哄疄娴嬫祦寮忔湡闂磋В鏋愰噺浠?~1000ms/s 闄嶅埌 ~4ms/s銆?
 *
 * 娉ㄦ剰锛氫笉鑳芥妸銆岀ǔ瀹氬墠缂€銆嶅綋浣滀竴涓暣浣撳瓧绗︿覆鍘?memo 鈥斺€?杈圭晫姣忔帹杩涗竴娆★紝鍓嶇紑瀛楃涓?
 * 灏卞彉浜嗭紝鏁寸瘒浼氳閲嶆柊瑙ｆ瀽锛堝疄娴嬪崟娆?346ms锛夈€傚繀椤绘寜鍧楃疮绉紙accumulateChunks锛夛紝
 * 杈圭晫鎺ㄨ繘鏃跺彧瑙ｆ瀽鏂板鐨勯偅涓€鍧椼€?
 *
 * 鈿狅笍 瀵煎嚭鍚?*涓嶈兘**鐢?`memo()` 鍖咃細react-test-renderer 鐨?
 * `findAllByType(MarkdownRenderer)` 渚濊禆 fiber.type 鏄粍浠舵湰浣擄紙memo 浼氭妸 fiber.type
 * 鎸囧悜鍐呭眰鍑芥暟 鈫?娴嬭瘯鍏ㄩ儴鎵句笉鍒帮級銆傚唴瀹逛笉鍙樻椂涓嶉噸瑙ｆ瀽鐢变袱灞備繚璇侊細
 *   1) `useMemo(..., [content])` 鈥斺€?content 涓嶅彉鍒欒烦杩囧垏鍒嗭紱
 *   2) `MarkdownChunk` 鐨?`memo` 鈥斺€?鍧楁枃鏈笉鍙樺垯姘镐笉閲嶈В鏋愩€?
 */

export interface MarkdownRendererDispatchProps extends MarkdownRendererProps {
  /** 榛樿鍙栧叏灞€寮€鍏筹紙MARKDOWN_ENGINE锛夛紱娴嬭瘯鍙敤瀹冩樉寮忚鐩?*/
  engine?: MarkdownEngine
}

/**
 * 鍏紑鍏ュ彛锛氭寜寮曟搸寮€鍏冲垎鍙戙€?
 * 鈿狅笍 蹇呴』淇濇寔**鏅€氬叿鍚嶅嚱鏁?*瀵煎嚭锛堜笉鑳借 memo 鍖呬綇锛夛紝鐞嗙敱鍚屼笂锛?
 * fiber.type 蹇呴』鏄粍浠舵湰浣擄紝`findAllByType(MarkdownRenderer)` 鎵嶈兘鍛戒腑銆?
 */
export const MarkdownRenderer: React.FC<MarkdownRendererDispatchProps> = ({
  content,
  engine = MARKDOWN_ENGINE,
}) =>
  engine === 'native' ? (
    <NativeMarkdown content={content} />
  ) : (
    <MarkdownRendererInner content={content} />
  )

const styles = StyleSheet.create({
  fallback: { fontSize: 14, lineHeight: 22 },
  streamCodeWrap: {
    alignSelf: 'stretch',
    padding: 16,
  },
  streamCodeText: {
    fontSize: 16,
    lineHeight: 24,
    fontStyle: 'italic',
    fontWeight: '300',
  },
  plainTail: {
    fontSize: 16,
    lineHeight: 24,
    paddingVertical: 8,
  },
})
