import React, { useState, useMemo, useEffect, useCallback } from "react";
import { getTextColor, lightenHex } from "../../../functions/colors"
import styles from "../../../styles/modules/ui/gantt_chart.module.css"

export type Task = {
    id: number | string;
    ganttId: number | string;
    area: string;
    item: string;
    is_plan: boolean;
    start: Date | null;
    end: Date | null;
    status?: 'Starting' | 'Executing' | 'Complete';
    color?: string;
    dependencies?: (number | string)[]; // Agora contém ganttIds
}

export type PlanData = { id: number | string; start: Date | null; end: Date | null; };
export type RealData = { id: number | string; start: Date | null; end: Date | null; status: string; };
export type DepsData = { ganttId: number | string; dependencies: (number | string)[]; };

type GanttChartProps = {
    tasks: Task[];
    onSave?: (plan: PlanData, real: RealData, deps: DepsData) => Promise<boolean>;
    onStart?: (id: number | string) => Promise<boolean>;
    onExecute?: (id: number | string) => Promise<boolean>;
    onComplete?: (id: number | string) => Promise<boolean>;
    onReset?: (id: number | string) => void;
    isEditor: boolean;
}

// Tipos internos para a estrutura agrupada da tabela
type GroupedItem = {
    name: string;
    ganttId: number | string;
    planTask?: Task;
    realTask?: Task;
    tasks: (Task & { flatIndex: number })[];
    realStatus: string;
    displayId: number;
    depsStr: string;
};

type GroupedArea = {
    name: string;
    color: string;
    items: GroupedItem[];
};

// Helpers para conversão de data (Data <-> Input YYYY-MM-DD mantendo consistência UTC)
const toDateInput = (d?: Date | null) => {
    if (!d) return "";
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

const parseDateInput = (str: string) => {
    if (!str) return null;
    return new Date(`${str}T00:00:00Z`);
};

const labelsSituacao = {
    start: 'Starting',
    executing: 'Executing',
    complete: 'Complete',
}

export const GanttChart = ({ tasks, onSave, onStart, onExecute, onComplete, onReset, isEditor }: GanttChartProps) => {
    const [hoveredDepId, setHoveredDepId] = useState<string | null>(null);
    const [popover, setPopover] = useState<{ x: number, y: number, task: Task } | null>(null);
    
    // --- ESTADO DE CONFIGURAÇÃO DA TABELA ---
    const [tableConfig, setTableConfig] = useState({
        hide: false,
        showActions: true,
        showDates: true,
        showStatus: true
    });
    const [showConfigMenu, setShowConfigMenu] = useState(false);

    const toggleConfig = (key: keyof typeof tableConfig) => {
        setTableConfig(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Estado do Popover de Configurações da Tarefa
    const [editingContext, setEditingContext] = useState<{
        x: number; y: number; item: GroupedItem;
        planStart: string; planEnd: string;
        realStart: string; realEnd: string;
        status: string; deps: string;
    } | null>(null);

    // --- ESTADO DAS LARGURAS DAS COLUNAS E DO GANTT ---
    const [colWidths, setColWidths] = useState({
        area: 100,
        actions: 40,
        id: 35,
        item: 100,
        type: 30,
        start: 55,
        end: 55,
        status: 75,
        deps: 60
    });
    
    const [svgWidth, setSvgWidth] = useState(1000); // Transformado em estado!

    // Definindo quem está sendo redimensionado (colunas ou o próprio svg)
    type ResizableElement = keyof typeof colWidths | 'svg';
    const [resizingElement, setResizingElement] = useState<ResizableElement | null>(null);
    const [startX, setStartX] = useState(0);
    const [startWidth, setStartWidth] = useState(0);

    // --- LÓGICA DE DRAG & DROP PARA COLUNAS E GANTT ---
    const handleMouseDown = (e: React.MouseEvent, element: ResizableElement) => {
        setResizingElement(element);
        setStartX(e.clientX);
        setStartWidth(element === 'svg' ? svgWidth : colWidths[element as keyof typeof colWidths]);
        e.preventDefault(); // Evita selecionar texto durante o arrasto
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!resizingElement) return;
            const diff = e.clientX - startX;
            
            if (resizingElement === 'svg') {
                // Impede que o gráfico fique menor que 300px
                const newWidth = Math.max(300, startWidth + diff);
                setSvgWidth(newWidth);
            } else {
                // Define uma largura mínima (30px) para não sumir com a coluna
                const newWidth = Math.max(30, startWidth + diff);
                setColWidths(prev => ({ ...prev, [resizingElement]: newWidth }));
            }
        };

        const handleMouseUp = () => {
            setResizingElement(null);
        };

        if (resizingElement) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizingElement, startX, startWidth]);


    const ROW_HEIGHT = 25;
    const ROW_PADDING = 4;
    const HEADER_HEIGHT = 50; 
    const MONTH_HEIGHT = 25;

    // A Tabela agora soma as larguras atuais do Estado E a configuração visual
    const TABLE_WIDTH = colWidths.area 
        + (tableConfig.showActions && isEditor ? colWidths.actions : 0) 
        + colWidths.id 
        + colWidths.item 
        + (tableConfig.showDates ? colWidths.type : 0) 
        + (tableConfig.showDates ? colWidths.start : 0) 
        + (tableConfig.showDates ? colWidths.end : 0) 
        + (tableConfig.showStatus ? colWidths.status : 0) 
        + colWidths.deps;

    const { renderTasks, groupedData, ganttIdMap, displayIdToGanttIdMap, taskLookup } = useMemo(() => {
        const areas: GroupedArea[] = [];
        const areaMap = new Map<string, GroupedArea>();
        
        let currentDisplayId = 1;
        const localGanttIdMap = new Map<number | string, number>();
        const localDisplayIdToGanttIdMap = new Map<number, number | string>();
        const localTaskLookup = new Map<string, string | number>(); 

        tasks.forEach(task => {
            if (!localGanttIdMap.has(task.ganttId)) {
                localGanttIdMap.set(task.ganttId, currentDisplayId);
                localDisplayIdToGanttIdMap.set(currentDisplayId, task.ganttId);
                currentDisplayId++;
            }

            localTaskLookup.set(`${task.ganttId}-${task.is_plan}`, task.id);

            let areaObj = areaMap.get(task.area);
            if (!areaObj) {
                areaObj = { name: task.area, color: task.color || "#cccccc", items: [] };
                areaMap.set(task.area, areaObj);
                areas.push(areaObj);
            }

            let itemObj = areaObj.items.find(i => i.ganttId === task.ganttId);
            if (!itemObj) {
                itemObj = {
                    name: task.item,
                    ganttId: task.ganttId,
                    tasks: [],
                    realStatus: "-",
                    displayId: localGanttIdMap.get(task.ganttId)!,
                    depsStr: ""
                };
                areaObj.items.push(itemObj);
            }

            itemObj.tasks.push({ ...task, flatIndex: 0 }); 
            
            if (!task.is_plan && task.status) {
                itemObj.realStatus = task.status;
            }
        });

        const flatTasks: (Task & { flatIndex: number })[] = [];
        let flatIndexCounter = 0;

        areas.forEach(a => {
            a.items.forEach(i => {
                i.tasks.sort((t1, t2) => (t1.is_plan === t2.is_plan) ? 0 : t1.is_plan ? -1 : 1);
                
                i.planTask = i.tasks.find(t => t.is_plan);
                i.realTask = i.tasks.find(t => !t.is_plan);

                const allDepsDisplayIds = new Set<number>();

                i.tasks.forEach(t => {
                    t.dependencies?.forEach(depGanttId => {
                        const displayId = localGanttIdMap.get(depGanttId);
                        if (displayId && displayId !== i.displayId) { 
                            allDepsDisplayIds.add(displayId);
                        }
                    });
                });
                
                i.depsStr = Array.from(allDepsDisplayIds).sort((x, y) => x - y).join(", ");

                i.tasks.forEach(t => {
                    t.flatIndex = flatIndexCounter++;
                    flatTasks.push(t);
                });
            });
        });

        return { 
            renderTasks: flatTasks, 
            groupedData: areas, 
            ganttIdMap: localGanttIdMap, 
            displayIdToGanttIdMap: localDisplayIdToGanttIdMap,
            taskLookup: localTaskLookup
        };
    }, [tasks]);

    const validTasks = renderTasks.filter(t => t.start != null && t.end != null);
    
    const startTimestamps = validTasks.map(t => (t.start as Date).getTime());
    const minTime = validTasks.length > 0 ? Math.min(...startTimestamps) : Date.now();
    const maxTime = validTasks.length > 0 ? Math.max(...validTasks.map(t => (t.end as Date).getTime())) : Date.now();

    const baseStart = new Date(minTime);
    const baseEnd = new Date(maxTime);

    const projectStartUTC = Date.UTC(baseStart.getUTCFullYear(), baseStart.getUTCMonth(), baseStart.getUTCDate() - 3);
    const projectEndUTC = Date.UTC(baseEnd.getUTCFullYear(), baseEnd.getUTCMonth(), baseEnd.getUTCDate() + 5);

    const ONE_DAY_IN_MS = 1000 * 60 * 60 * 24;
    const totalDays = Math.round((projectEndUTC - projectStartUTC) / ONE_DAY_IN_MS) || 1;
    
    // Agora dayWidth reage dinamicamente ao arrasto do mouse!
    const dayWidth = svgWidth / totalDays;
    const TOTAL_HEIGHT = HEADER_HEIGHT + (renderTasks.length * ROW_HEIGHT); 

    const getTaskX = (targetDate: Date) => {
        const targetUTC = Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate());
        const diffMs = targetUTC - projectStartUTC;
        return (diffMs / ONE_DAY_IN_MS) * dayWidth;
    };

    const formatDateSafe = (d: Date | null) => {
        if (!d) return "-"; 
        return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth()+1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(-2)}`;
    };

    const monthsData: { dateObj: Date, startX: number, width: number }[] = [];
    const weeksData: { label: string, startX: number }[] = [];

    let currentMonth = -1;
    let currentMonthStartX = 0;
    let sundayCount = 0;

    const weekPixelWidth = 7 * dayWidth;
    let weekStep = 1;
    if (weekPixelWidth < 15) {
        weekStep = 4;
    } else if (weekPixelWidth < 40) {
        weekStep = 2;
    }

    for (let i = 0; i <= totalDays; i++) {
        const currentDayUTC = projectStartUTC + (i * ONE_DAY_IN_MS);
        const d = new Date(currentDayUTC);
        const x = i * dayWidth;
        const m = d.getUTCMonth();

        if (m !== currentMonth) {
            if (currentMonth !== -1) {
                monthsData[monthsData.length - 1].width = x - currentMonthStartX;
            }
            currentMonth = m;
            currentMonthStartX = x;
            monthsData.push({ dateObj: d, startX: x, width: 0 }); 
        }

        if (d.getUTCDay() === 0) { 
            if (sundayCount % weekStep === 0) {
                weeksData.push({ 
                    label: `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth()+1).padStart(2, '0')}`, 
                    startX: x 
                });
            }
            sundayCount++;
        }
    }

    if (monthsData.length > 0) {
        monthsData[monthsData.length - 1].width = svgWidth - currentMonthStartX;
    }

    const taskCoordsMap = new Map<number | string, { startX: number, endX: number, centerY: number }>();
    
    renderTasks.forEach((task, index) => {
        if (!task.start || !task.end) return;

        const startX = getTaskX(task.start);
        const endX = getTaskX(task.end);
        taskCoordsMap.set(task.id, {
            startX,
            endX,
            centerY: HEADER_HEIGHT + (index * ROW_HEIGHT) + (ROW_HEIGHT / 2)
        });
    });

    const dependenciesToRender: { id: string, pathData: string }[] = [];
    renderTasks.forEach(task => {
        if (!task.dependencies) return;

        task.dependencies.forEach(depGanttId => {
            const fromTaskId = taskLookup.get(`${depGanttId}-${task.is_plan}`);
            if (!fromTaskId) return;

            const fromCoords = taskCoordsMap.get(fromTaskId);
            const toCoords = taskCoordsMap.get(task.id);

            if (fromCoords && toCoords) {
                const isForward = toCoords.startX > fromCoords.endX + 20;
                let pathData = "";

                if (isForward) {
                    const midX = fromCoords.endX + (toCoords.startX - fromCoords.endX) / 3;
                    pathData = `M ${fromCoords.endX} ${fromCoords.centerY} 
                                L ${midX} ${fromCoords.centerY} 
                                L ${midX} ${toCoords.centerY} 
                                L ${toCoords.startX - 6} ${toCoords.centerY}`;
                } else {
                    const dropY = fromCoords.centerY + ROW_HEIGHT / 2 + 5;
                    pathData = `M ${fromCoords.endX} ${fromCoords.centerY} 
                                L ${fromCoords.endX + 15} ${fromCoords.centerY} 
                                L ${fromCoords.endX + 15} ${dropY} 
                                L ${toCoords.startX - 15} ${dropY} 
                                L ${toCoords.startX - 15} ${toCoords.centerY} 
                                L ${toCoords.startX - 6} ${toCoords.centerY}`;
                }

                dependenciesToRender.push({
                    id: `${fromTaskId}-${task.id}`,
                    pathData
                });
            }
        });
    });

    const handleOnStart = useCallback(async () => {
        const success = await onStart?.(editingContext?.item.realTask?.id || ""); 
        if(success) setEditingContext(null);
    }, [onStart, setEditingContext, editingContext]);

    const handleOnExecute = useCallback(async () => {
        const success = await onExecute?.(editingContext?.item.realTask?.id || ""); 
        if(success) setEditingContext(null);
    }, [onExecute, setEditingContext, editingContext]);

    const handleOnComplete = useCallback(async () => {
        const success = await onComplete?.(editingContext?.item.realTask?.id || ""); 
        if(success) setEditingContext(null);
    }, [onComplete, setEditingContext, editingContext]);

    const handleSave = useCallback(async () => {
        if (!editingContext || !onSave) return;
        const { item, planStart, planEnd, realStart, realEnd, status, deps } = editingContext;

        const planData: PlanData = {
            id: item.planTask?.id ?? "",
            start: parseDateInput(planStart),
            end: parseDateInput(planEnd)
        };

        const realData: RealData = {
            id: item.realTask?.id ?? "",
            start: parseDateInput(realStart),
            end: parseDateInput(realEnd),
            status: status
        };

        const depsDisplayIds = deps.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        const rawGanttDeps = depsDisplayIds.map(dId => displayIdToGanttIdMap.get(dId)).filter(Boolean) as (string | number)[];

        const depsData: DepsData = {
            ganttId: item.ganttId,
            dependencies: rawGanttDeps
        };

        const success = await onSave(planData, realData, depsData);
        if(success) setEditingContext(null); 
    }, [editingContext, displayIdToGanttIdMap, onSave, setEditingContext]);

    // --- COMPONENTE DE REDIMENSIONAMENTO ---
    const Resizer = ({ element }: { element: ResizableElement }) => (
        <div
            onMouseDown={(e) => handleMouseDown(e, element)}
            style={{
                position: 'absolute', right: 0, top: 0, bottom: 0, width: '6px',
                cursor: 'col-resize', zIndex: 10,
                backgroundColor: 'transparent',
                opacity: resizingElement === element ? 1 : 0.2
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#94a3b8'; e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { 
                if(resizingElement !== element) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.opacity = '0.2'; }
            }}
        />
    );

    return (
        <div style={{ maxWidth: "100%", width: "fit-content", margin: "0 auto", overflowX: "auto", paddingBottom: "16px" }}>
            
            {/* --- CONTROLES DE EXIBIÇÃO --- */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px", position: "relative" }}>
                <button 
                    onClick={() => setShowConfigMenu(!showConfigMenu)}
                    style={{ 
                        padding: "6px 12px", fontSize: "0.75rem", background: "#f8fafc", border: "1px solid #cbd5e1", 
                        borderRadius: "6px", cursor: "pointer", fontWeight: "bold", color: "#334155", 
                        display: "flex", alignItems: "center", gap: "6px", transition: "all 0.2s" 
                    }}
                >
                    <span style={{fontSize: "1rem"}}>👁️</span> Display Options
                </button>

                {showConfigMenu && (
                    <div style={{
                        position: "absolute", top: "100%", right: 0, marginTop: "6px",
                        backgroundColor: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "8px",
                        padding: "12px", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                        zIndex: 2000, display: "flex", flexDirection: "column", gap: "10px", minWidth: "160px"
                    }}>
                        <div style={{ fontWeight: "bold", fontSize: "0.8rem", color: "#0f172a", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
                            Table Columns
                        </div>
                        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.75rem", cursor: "pointer", color: "#334155" }}>
                            <input type="checkbox" checked={!tableConfig.hide} onChange={() => toggleConfig('hide')} />
                            Show Sidebar Table
                        </label>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingLeft: "8px", borderLeft: "2px solid #e2e8f0", marginLeft: "4px", opacity: tableConfig.hide ? 0.5 : 1, pointerEvents: tableConfig.hide ? 'none' : 'auto' }}>
                            {isEditor && 
                                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.75rem", cursor: "pointer", color: "#475569" }}>
                                    <input type="checkbox" checked={tableConfig.showActions} onChange={() => toggleConfig('showActions')} />
                                    Actions (⚙️)
                                </label>
                            }
                            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.75rem", cursor: "pointer", color: "#475569" }}>
                                <input type="checkbox" checked={tableConfig.showDates} onChange={() => toggleConfig('showDates')} />
                                Dates (Start/End)
                            </label>
                            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.75rem", cursor: "pointer", color: "#475569" }}>
                                <input type="checkbox" checked={tableConfig.showStatus} onChange={() => toggleConfig('showStatus')} />
                                Status
                            </label>
                        </div>
                    </div>
                )}
            </div>

            <div style={{ 
                display: "flex", 
                width: `${(!tableConfig.hide ? TABLE_WIDTH : 0) + svgWidth}px`, 
                border: '1px solid #e2e8f0', 
                borderRadius: '8px', 
                overflow: 'hidden', 
                backgroundColor: "#fff"
            }}>
                
                {/* 4.A - TABELA LATERAL */}
                {!tableConfig.hide && (
                <div style={{ width: `${TABLE_WIDTH}px`, flexShrink: 0, borderRight: '1px solid #cbd5e1', display: 'flex', flexDirection: 'column' }}>
                    
                    <div style={{
                        display: 'flex', alignItems: 'center', height: `${HEADER_HEIGHT}px`,
                        backgroundColor: '#f1f5f9', borderBottom: '1px solid #cbd5e1',
                        fontSize: '0.75rem', fontWeight: 'bold', color: '#334155', boxSizing: 'border-box'
                    }}>
                        <div style={{ position: 'relative', width: `${colWidths.area}px`, textAlign: 'center', flexShrink: 0, borderRight: "0.1rem #c0c5cc solid" }}>
                            Area <Resizer element="area" />
                        </div>
                        
                        {tableConfig.showActions && isEditor && (
                        <div title="Actions" style={{ position: 'relative', width: `${colWidths.actions}px`, textAlign: 'center', flexShrink: 0, borderRight: "0.1rem #c0c5cc solid" }}>
                            ⚙️ <Resizer element="actions" />
                        </div>
                        )}
                        
                        <div style={{ position: 'relative', width: `${colWidths.id}px`, textAlign: 'center', flexShrink: 0, borderRight: "0.1rem #c0c5cc solid" }}>
                            ID
                        </div>
                        
                        <div style={{ position: 'relative', width: `${colWidths.item}px`, paddingLeft: '8px', flexShrink: 0, textAlign: 'left', borderRight: "0.1rem #c0c5cc solid" }}>
                            Item <Resizer element="item" />
                        </div>
                        
                        {tableConfig.showDates && (
                        <div title="Type" style={{ position: 'relative', width: `${colWidths.type}px`, textAlign: 'center', flexShrink: 0, borderRight: "0.1rem #c0c5cc solid" }}>
                            T. <Resizer element="type" />
                        </div>
                        )}
                        
                        {tableConfig.showDates && (
                        <div style={{ position: 'relative', width: `${colWidths.start}px`, textAlign: 'center', flexShrink: 0, borderRight: "0.1rem #c0c5cc solid" }}>
                            Start <Resizer element="start" />
                        </div>
                        )}
                        
                        {tableConfig.showDates && (
                        <div style={{ position: 'relative', width: `${colWidths.end}px`, textAlign: 'center', flexShrink: 0, borderRight: "0.1rem #c0c5cc solid" }}>
                            End <Resizer element="end" />
                        </div>
                        )}
                        
                        {tableConfig.showStatus && (
                        <div style={{ position: 'relative', width: `${colWidths.status}px`, textAlign: 'center', flexShrink: 0, borderRight: "0.1rem #c0c5cc solid" }}>
                            Status <Resizer element="status" />
                        </div>
                        )}
                        
                        <div title="Dependencies" style={{ position: 'relative', width: `${colWidths.deps}px`, textAlign: 'center', flexShrink: 0 }}>
                            Dep. <Resizer element="deps" />
                        </div>
                    </div>

                    {groupedData.map((area, aIdx) => (
                        <div key={`area-${aIdx}`} style={{ display: 'flex', backgroundColor: lightenHex(area.color, 70), color: getTextColor(lightenHex(area.color, 70)) }}>
                            <div 
                                title={area.name} 
                                style={{ width: `${colWidths.area}px`, flexShrink: 0, display: 'flex', 
                                
                                    alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #e2e8f0', 
                                    borderBottom: '1px solid #e2e8f0', padding: '0 4px', textAlign: 'center', fontSize: '0.75rem', 
                                    color: getTextColor(lightenHex(area.color, 70)), fontWeight: 'bold', boxSizing: 'border-box', overflow: 'hidden' }}
                            >
                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                                    {area.name}
                                </span>
                            </div>
                            
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {area.items.map((item, iIdx) => (
                                    <div key={`item-${iIdx}`} style={{ display: 'flex' }}>
                                        
                                        {tableConfig.showActions && isEditor && (
                                        <div style={{ width: `${colWidths.actions}px`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', boxSizing: 'border-box' }}>
                                            <button 
                                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '1rem', padding: '4px' }}
                                                onClick={(e) => {
                                                    if(!isEditor){
                                                        return;
                                                    }
                                                    if(editingContext){
                                                        setEditingContext(null);
                                                        return;
                                                    }
                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                    setEditingContext({
                                                        x: rect.left,
                                                        y: rect.bottom + 5,
                                                        item: item,
                                                        planStart: toDateInput(item.planTask?.start),
                                                        planEnd: toDateInput(item.planTask?.end),
                                                        realStart: toDateInput(item.realTask?.start),
                                                        realEnd: toDateInput(item.realTask?.end),
                                                        status: item.realStatus !== "-" ? item.realStatus : "",
                                                        deps: item.depsStr
                                                    });
                                                }}
                                            >
                                                ⚙️
                                            </button>
                                        </div>
                                        )}

                                        <div style={{ width: `${colWidths.id}px`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', fontSize: '0.75rem', fontWeight: 'bold', color: '#0f172a', boxSizing: 'border-box' }}>
                                            {item.displayId}
                                        </div>

                                        <div 
                                            title={item.name} 
                                            style={{ width: `${colWidths.item}px`, flexShrink: 0, display: 'flex', alignItems: 'center', textAlign: "left", padding: '0 8px', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', fontSize: '0.75rem', color: getTextColor(lightenHex(area.color, 70)), overflow: 'hidden', boxSizing: 'border-box' }}
                                        >
                                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                                                {item.name}
                                            </span>
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', width: `${(tableConfig.showDates ? colWidths.type : 0) + (tableConfig.showDates ? colWidths.start : 0) + (tableConfig.showDates ? colWidths.end : 0)}px`, flexShrink: 0 }}>
                                            {item.tasks.map((t, tIdx) => (
                                                <div key={t.id} style={{ 
                                                    display: 'flex', height: `${ROW_HEIGHT}px`, boxSizing: 'border-box',
                                                    borderBottom: '1px solid #e2e8f0',
                                                    backgroundColor: lightenHex(area.color, 70),
                                                    fontSize: '0.7rem', color: getTextColor(lightenHex(area.color, 70))
                                                }}>
                                                    {tableConfig.showDates && (
                                                        <>    
                                                            <div style={{ width: `${colWidths.type}px`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }} title={t.is_plan ? "Planned" : "Actual"}>
                                                                {t.is_plan ? 'P' : 'A'}
                                                            </div>
                                                            <div style={{ width: `${colWidths.start}px`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                                                                {formatDateSafe(t.start)}
                                                            </div>
                                                            <div style={{ width: `${colWidths.end}px`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', borderRight: '1px solid #e2e8f0' }}>
                                                                {formatDateSafe(t.end)}
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            ))}
                                        </div>

                                        {tableConfig.showStatus && (
                                            <div 
                                                title={labelsSituacao[item.realStatus as keyof typeof labelsSituacao] || item.realStatus}
                                                style={{ width: `${colWidths.status}px`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', fontSize: '0.75rem', color: getTextColor(lightenHex(area.color, 70)), textAlign: 'center', padding: '0 4px', boxSizing: 'border-box', overflow: 'hidden' }}
                                            >
                                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                                                    {labelsSituacao[item.realStatus as keyof typeof labelsSituacao] || item.realStatus}
                                                </span>
                                            </div>
                                        )}

                                        <div 
                                            title={item.depsStr || "-"}
                                            style={{ width: `${colWidths.deps}px`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #e2e8f0', fontSize: '0.75rem', color: getTextColor(lightenHex(area.color, 70)), textAlign: 'center', padding: '0 4px', boxSizing: 'border-box', overflow: 'hidden' }}
                                        >
                                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                                                {item.depsStr || "-"}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
                )}

                {/* 4.B - GANTT CHART (SVG) COM ALÇA DE RESIZE */}
                <div style={{ width: `${svgWidth}px`, flexShrink: 0, position: "relative", backgroundColor: "#fff" }}>
                    <svg width={svgWidth} height={TOTAL_HEIGHT} viewBox={`0 0 ${svgWidth} ${TOTAL_HEIGHT}`} style={{ display: "block" }}>
                        <defs>
                            <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#cbd5e1" />
                            </marker>
                            <marker id="arrow-hover" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
                            </marker>
                        </defs>

                        {renderTasks.map((_, index) => {
                            const y = HEADER_HEIGHT + (index * ROW_HEIGHT);
                            return (
                                <g key={`grid-${index}`}>
                                    <rect x={0} y={y} width={svgWidth} height={ROW_HEIGHT} fill={index % 2 === 0 ? "#ffffff" : "#f8fafc"} />
                                    <line x1={0} y1={y + ROW_HEIGHT} x2={svgWidth} y2={y + ROW_HEIGHT} stroke="#e2e8f0" strokeWidth={1} />
                                </g>
                            );
                        })}

                        {monthsData.map((month, i) => (
                            i > 0 && <line key={`m-line-${i}`} x1={month.startX} y1={0} x2={month.startX} y2={TOTAL_HEIGHT} stroke="#cbd5e1" strokeWidth={1.5} />
                        ))}
                        {weeksData.map((week, i) => (
                            <line key={`w-line-${i}`} x1={week.startX} y1={MONTH_HEIGHT} x2={week.startX} y2={TOTAL_HEIGHT} stroke="#e2e8f0" strokeDasharray="4 4" strokeWidth={1.5} />
                        ))}

                        {dependenciesToRender.map(dep => {
                            if (dep.id === hoveredDepId) return null;
                            return (
                                <path
                                    key={dep.id} d={dep.pathData} fill="none" stroke="#cbd5e1" strokeWidth={1.5} markerEnd="url(#arrow)"
                                    onMouseEnter={() => setHoveredDepId(dep.id)} onMouseLeave={() => setHoveredDepId(null)}
                                    style={{ cursor: "pointer", transition: "stroke 0.2s" }}
                                />
                            );
                        })}

                        {renderTasks.map((task, index) => {
                            const coords = taskCoordsMap.get(task.id);
                            if (!coords) return null; 
                            const y = HEADER_HEIGHT + (index * ROW_HEIGHT);
                            
                            const baseColor = task.color || "#3b82f6";
                            const barOpacity = task.is_plan ? 0.35 : 1; 
                            const strokeColor = task.is_plan ? baseColor : "none";
                            const strokeWidth = task.is_plan ? 1 : 0;

                            return (
                                <rect
                                    key={`task-${task.id}`} x={coords.startX} y={y + ROW_PADDING}
                                    width={Math.max(coords.endX - coords.startX, 4)} height={ROW_HEIGHT - (ROW_PADDING * 2)}
                                    fill={baseColor} fillOpacity={barOpacity} stroke={strokeColor} strokeWidth={strokeWidth} rx={4} ry={4}
                                    style={{ cursor: "pointer", transition: "filter 0.2s" }}
                                    onMouseMove={(e) => setPopover({ x: e.clientX, y: e.clientY, task: task })}
                                    onMouseLeave={() => setPopover(null)}
                                />
                            );
                        })}

                        {dependenciesToRender.map(dep => {
                            if (dep.id !== hoveredDepId) return null;
                            return (
                                <path
                                    key={`hover-${dep.id}`} d={dep.pathData} fill="none" stroke="#3b82f6" strokeWidth={2.5} markerEnd="url(#arrow-hover)"
                                    onMouseEnter={() => setHoveredDepId(dep.id)} onMouseLeave={() => setHoveredDepId(null)} style={{ cursor: "pointer" }}
                                />
                            );
                        })}

                        <g id="timeline-header">
                            <rect x={0} y={0} width={svgWidth} height={HEADER_HEIGHT} fill="#f1f5f9" opacity={0.95} />
                            <line x1={0} y1={HEADER_HEIGHT} x2={svgWidth} y2={HEADER_HEIGHT} stroke="#cbd5e1" strokeWidth={1} />
                            
                            {monthsData.map((month, i) => {
                                const rawCenter = month.startX + (month.width / 2);
                                const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                                const fullMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                                
                                let label = "";
                                if (month.width >= 120) label = `${fullMonths[month.dateObj.getUTCMonth()]} ${month.dateObj.getUTCFullYear()}`;
                                else if (month.width >= 70) label = `${shortMonths[month.dateObj.getUTCMonth()]}/${month.dateObj.getUTCFullYear()}`;
                                else if (month.width >= 35) label = shortMonths[month.dateObj.getUTCMonth()];

                                return <text key={`m-text-${i}`} x={rawCenter} y={18} fontSize="12" fontWeight="bold" fill="#334155" textAnchor="middle">{label}</text>;
                            })}

                            {weeksData.map((week, i) => {
                                return <text key={`w-text-${i}`} x={week.startX + 5} y={MONTH_HEIGHT + 16} fontSize="10" fill="#64748b" textAnchor="start">{week.label}</text>;
                            })}
                        </g>
                    </svg>
                    
                    {/* Alça interativa para redimensionar o gráfico SVG */}
                    <Resizer element="svg" />
                </div>
            </div>

            {/* TOOLTIP DO MOUSE NO GRÁFICO */}
            {popover && !editingContext && (
                <div style={{ position: "fixed", left: popover.x + 15, top: popover.y + 15, backgroundColor: "#1e293b", color: "#f8fafc", padding: "8px 12px", borderRadius: "6px", fontSize: "0.875rem", pointerEvents: "none", zIndex: 1000, boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}>
                    <p style={{ margin: 0, fontWeight: "bold" }}>{ganttIdMap.get(popover.task.ganttId)} - {popover.task.area} / {popover.task.item}</p>
                    <p style={{ margin: 0, fontSize: "0.75rem", color: "#38bdf8", fontWeight: "bold" }}>[{popover.task.is_plan ? "Planned" : "Actual"}]</p>
                    <p style={{ margin: '4px 0 0 0', fontSize: "0.75rem", color: "#94a3b8" }}>Start: {formatDateSafe(popover.task.start)}</p>
                    <p style={{ margin: 0, fontSize: "0.75rem", color: "#94a3b8" }}>End: {formatDateSafe(popover.task.end)}</p>
                </div>
            )}

            {/* MODAL / POPOVER DE EDIÇÃO */}
            {editingContext && (
                <div 
                    className={styles.quick_update_popover}
                style={{
                    position: 'fixed',
                    left: `${Math.min(editingContext.x, window.innerWidth - 300)}px`,
                    top: `${Math.min(editingContext.y, window.innerHeight - 400)}px`,
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '16px',
                    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
                    zIndex: 999,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                }}>
                    <div style={{ fontWeight: 'bold', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Actions: {editingContext.item.name}</span>
                        <span style={{color: '#94a3b8', fontSize: '0.75rem'}}>ID: {editingContext.item.displayId}</span>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button onClick={handleOnStart} style={{ flex: 1, padding: '4px', fontSize: '0.75rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Start</button>
                        <button onClick={handleOnExecute} style={{ flex: 1, padding: '4px', fontSize: '0.75rem', background: '#eab308', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Execute</button>
                        <button onClick={handleOnComplete} style={{ flex: 1, padding: '4px', fontSize: '0.75rem', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Complete</button>
                        <button onClick={() => {onReset?.(editingContext.item.realTask?.id || ""); setEditingContext(null)}} style={{ flex: 1, padding: '4px', fontSize: '0.75rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Reset</button>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.7rem', color: '#64748b' }}>Start (Plan)</label>
                            <input type="date" value={editingContext.planStart} onChange={(e) => setEditingContext({ ...editingContext, planStart: e.target.value })} style={{ padding: '4px', fontSize: '0.75rem' }} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.7rem', color: '#64748b' }}>End (Plan)</label>
                            <input type="date" value={editingContext.planEnd} onChange={(e) => setEditingContext({ ...editingContext, planEnd: e.target.value })} style={{ padding: '4px', fontSize: '0.75rem' }} />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.7rem', color: '#64748b' }}>Start (Actual)</label>
                            <input type="date" value={editingContext.realStart} onChange={(e) => setEditingContext({ ...editingContext, realStart: e.target.value })} style={{ padding: '4px', fontSize: '0.75rem' }} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.7rem', color: '#64748b' }}>End (Actual)</label>
                            <input type="date" value={editingContext.realEnd} onChange={(e) => setEditingContext({ ...editingContext, realEnd: e.target.value })} style={{ padding: '4px', fontSize: '0.75rem' }} />
                        </div>
                    </div>

                    <div>
                        <label style={{ fontSize: '0.7rem', color: '#64748b' }}>Status (Actual)</label>
                        <select value={editingContext.status} onChange={(e) => setEditingContext({ ...editingContext, status: e.target.value })} style={{ width: '100%', padding: '4px', fontSize: '0.75rem', boxSizing: 'border-box' }}>
                            <option value={"start"}>Starting</option>
                            <option value={"executing"}>Executing</option>
                            <option value={"complete"}>Complete</option>
                        </select>
                    </div>

                    <div>
                        <label style={{ fontSize: '0.7rem', color: '#64748b' }}>Predecessors (IDs)</label>
                        <input type="text" value={editingContext.deps} onChange={(e) => setEditingContext({ ...editingContext, deps: e.target.value })} placeholder="Ex: 1, 4" style={{ width: '100%', padding: '4px', fontSize: '0.75rem', boxSizing: 'border-box' }} />
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                        <button onClick={() => setEditingContext(null)} style={{ flex: 1, padding: '6px', fontSize: '0.75rem', background: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                            Cancel
                        </button>
                        <button onClick={handleSave} style={{ flex: 1, padding: '6px', fontSize: '0.75rem', background: '#0f172a', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                            Save
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};