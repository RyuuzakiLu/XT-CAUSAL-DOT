import type { StackImage, StackLoader } from './ImageStack.tsx';
export interface GroupMember {
    anchor: Element;
    image: StackImage;
    loadImage: StackLoader;
}
export interface ImageGroup {
    members: Map<symbol, GroupMember>;
    version: number;
    listeners: Set<() => void>;
}
/** 锚点所在的那一行附件容器；找不到时退回父元素（测试或别的槽主）。 */
export declare function groupRoot(anchor: Element): Element | null;
export declare function groupOf(root: Element): ImageGroup;
export declare function joinGroup(g: ImageGroup, id: symbol, member: GroupMember): () => void;
/** 按锚点在文档里的先后排成一组。 */
export declare function orderedMembers(g: ImageGroup): Array<[symbol, GroupMember]>;
