/** 听辨小测的内容（最小对立对）。**只有这个文件可以放内容**；界面代码一个字都不许自己编。
 *  每个词的 ipa 都取自实际打开过的词典页（src 字段），查不到的词已经换掉（底线 3）。
 *
 *  **出处说明（2026-11-10 逐词抓页核对）**：
 *   - `ipa`：16 个词全部 `curl` 下剑桥词典的**词条页**，在 HTML 的
 *     `<span class="us dpron-i">…<span class="pron dpron">` 节点里取**第一条 us（美式）**音标，一字未改。
 *     没有一条是凭记忆写的，也没有一条来自搜索引擎摘要。单音节词剑桥本来就不标重音符号，不是漏了。
 *   - `src`：就是那张词条页的地址，可以点开核对。
 *   - **`contrast` / `explain` / `tie` 不是词典原文**：`contrast` 是本会话按上面两条 ipa
 *     **逐音素比对**后写的；`explain` 是按发音部位的通例写的教学提示（嘴型、舌位），
 *     没有逐条出处，不要当成剑桥的话引用（底线 3、9）。
 *   - 🔸【推断】"中文母语者普遍吃力"：p5～p8 这四组（/θ/-/s/、/v/-/w/、/n/-/ŋ/、词尾辅音在不在）
 *     是本会话按常见教学经验挑的，**没找到可引用的来源**，标成推断，不要当成证实的结论。
 *
 *  **为什么是这 8 组**：Amos 的问题是"读不准 → 脑子里的音不清楚 → 听不出来"，
 *  所以直接测耳朵：放一段音，从只差一个音的两个词里选听到哪个。
 *  p1～p4 的那个音分别挂在带练场景 0 的 `catch` /kætʃ/、`mean` /miːn/、`lost` /lɑːst/、
 *  `rephrase` /ˌriːˈfreɪz/ 上（见 `tie`），练到的音是他已经在念的音；p5～p8 挂不上，`tie` 写 null。
 *
 *  **p8 要单独说一句**：card /kɑːrd/ 和 car /kɑːr/ 差的是**词尾多不多一个 /d/**，
 *  是"有没有"而不是"换成别的"，和前七组的替换型对立不一样——这是故意留的一组，
 *  因为中文没有这种词尾塞音，但严格说它不是同长度的替换（底线 9：说清楚，别圆过去）。
 */

/** 一个词：词形 + 美式音标 + 音标出处 */
export interface EarWord { id: string; word: string; ipa: string; src: string }

/** 一组最小对立对 */
export interface EarPair {
  id: string;            // p1..p8
  contrast: string;      // 在分什么音，例如 '/æ/ 和 /e/'
  explain: string;       // 一行中文，≤30 字：这两个音差在哪、嘴型或舌位怎么不同
  tie: string | null;    // 挂在带练哪一项上，例如 'catch'；挂不上写 null
  a: EarWord;
  b: EarWord;
}

/** 剑桥词典词条页（下面反复引用，集中放一处，改地址只改这里） */
const C = (slug: string) => `https://dictionary.cambridge.org/dictionary/english/${slug}`;

/** 8 组：p1～p4 挂得上带练的 6 个词，p5～p8 是另挑的对立 */
export const PAIRS: EarPair[] = [
  {
    id: 'p1',
    contrast: '/æ/ 和 /e/',
    explain: '/æ/ 嘴张更大、下巴更低；/e/ 开口小、嘴型扁',
    tie: 'catch',
    a: { id: 'p1a', word: 'bad', ipa: '/bæd/', src: C('bad') },
    b: { id: 'p1b', word: 'bed', ipa: '/bed/', src: C('bed') },
  },
  {
    id: 'p2',
    contrast: '/iː/ 和 /ɪ/',
    explain: '/iː/ 长、嘴角后拉绷紧；/ɪ/ 短、嘴和舌都松',
    tie: 'mean',
    a: { id: 'p2a', word: 'seat', ipa: '/siːt/', src: C('seat') },
    b: { id: 'p2b', word: 'sit', ipa: '/sɪt/', src: C('sit') },
  },
  {
    id: 'p3',
    contrast: '/ɑː/ 和 /ʌ/',
    explain: '/ɑː/ 嘴大开、舌头后缩拉长；/ʌ/ 嘴半开、很短',
    tie: 'lost',
    a: { id: 'p3a', word: 'lock', ipa: '/lɑːk/', src: C('lock') },
    b: { id: 'p3b', word: 'luck', ipa: '/lʌk/', src: C('luck') },
  },
  {
    id: 'p4',
    contrast: '/r/ 和 /l/',
    explain: '/r/ 舌尖悬空不碰上颚；/l/ 舌尖顶住上齿龈',
    tie: 'rephrase',
    a: { id: 'p4a', word: 'right', ipa: '/raɪt/', src: C('right') },
    b: { id: 'p4b', word: 'light', ipa: '/laɪt/', src: C('light') },
  },
  {
    id: 'p5',
    contrast: '/θ/ 和 /s/',
    explain: '/θ/ 舌尖伸到上下齿之间漏气；/s/ 舌尖不出齿',
    tie: null,
    a: { id: 'p5a', word: 'think', ipa: '/θɪŋk/', src: C('think') },
    b: { id: 'p5b', word: 'sink', ipa: '/sɪŋk/', src: C('sink') },
  },
  {
    id: 'p6',
    contrast: '/v/ 和 /w/',
    explain: '/v/ 上齿咬下唇、有摩擦；/w/ 双唇收圆、不碰齿',
    tie: null,
    a: { id: 'p6a', word: 'vest', ipa: '/vest/', src: C('vest') },
    b: { id: 'p6b', word: 'west', ipa: '/west/', src: C('west') },
  },
  {
    id: 'p7',
    contrast: '/n/ 和 /ŋ/',
    explain: '/n/ 舌尖顶上齿龈；/ŋ/ 舌尖不动、舌根抬起堵住',
    tie: null,
    a: { id: 'p7a', word: 'thin', ipa: '/θɪn/', src: C('thin') },
    b: { id: 'p7b', word: 'thing', ipa: '/θɪŋ/', src: C('thing') },
  },
  {
    id: 'p8',
    contrast: '词尾 /d/ 在不在',
    explain: 'card 收尾多个轻轻的 /d/；car 到 /r/ 就停',
    tie: null,
    a: { id: 'p8a', word: 'card', ipa: '/kɑːrd/', src: C('card') },
    b: { id: 'p8b', word: 'car', ipa: '/kɑːr/', src: C('car') },
  },
];
