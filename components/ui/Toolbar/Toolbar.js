import { CircleQuestionMark, Download, Link } from "lucide-react"
import styles from "../../../styles/modules/ui/toolbar.module.css"
import { useToolbar } from "../../../hooks/useToolbar"

export const Toolbar = ({ children }) => {
    const { helpClick, exportCSVClick, generatePreviewLink } = useToolbar();

    if(!helpClick && !exportCSVClick) return;

    return (
        <div className={styles.toolbar_div}>
            <button 
                hidden={!generatePreviewLink}
                data-tooltip="Generate preview link"
                onClick={generatePreviewLink}
                className={styles.toolbar_button}>
                <Link size={30} />
            </button>

            <button 
                hidden={!exportCSVClick}
                data-tooltip="Export to .csv file"
                onClick={exportCSVClick}
                className={styles.toolbar_button}>
                <Download size={30} />
            </button>

            <button data-tooltip="Help"
                hidden={!helpClick}
                onClick={helpClick}
                className={styles.toolbar_button}>
                <CircleQuestionMark size={30} />
            </button>
        </div>
    )
}