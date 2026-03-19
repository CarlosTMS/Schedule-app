import React, { useState, useRef } from 'react';
import { UploadCloud, FileSpreadsheet } from 'lucide-react';

interface FileUploadProps {
    onFileSelect: (file: File) => void;
}

export function FileUpload({ onFileSelect }: FileUploadProps) {
    const [dragActive, setDragActive] = useState(false);
    const [fileName, setFileName] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const file = e.dataTransfer.files[0];
            handleFile(file);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const handleFile = (file: File) => {
        setFileName(file.name);
        onFileSelect(file);
    };

    const onButtonClick = () => {
        inputRef.current?.click();
    };

    return (
        <div
            className={`glass-panel ${dragActive ? 'drag-active' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '3rem 2rem',
                border: dragActive ? '2px dashed var(--primary-color)' : '2px dashed var(--border-color)',
                transition: 'all 0.3s ease',
                cursor: 'pointer',
                textAlign: 'center',
                background: dragActive ? 'rgba(59, 130, 246, 0.05)' : 'var(--glass-bg)'
            }}
            onClick={onButtonClick}
        >
            <input
                ref={inputRef}
                type="file"
                accept=".xlsx, .xls, .json"
                onChange={handleChange}
                style={{ display: 'none' }}
            />

            {fileName ? (
                <>
                    <FileSpreadsheet size={48} color="var(--success-color)" style={{ marginBottom: '1rem' }} />
                    <h3 style={{ margin: 0 }}>{fileName}</h3>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Click or drag a different file to replace</p>
                </>
            ) : (
                <>
                    <UploadCloud size={48} color="var(--primary-color)" style={{ marginBottom: '1rem' }} />
                    <h3 style={{ margin: 0, marginBottom: '0.5rem' }}>Upload JSON Summary or Excel Data</h3>
                    <p style={{ color: 'var(--text-secondary)' }}>Drag and drop your exported summary (.json) or SAP student dataset (.xlsx) here, or click to browse</p>
                </>
            )}
        </div>
    );
}
