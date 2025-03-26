---
title: "Markdown Syntax Showcase"
description: "A comprehensive example of Markdown syntax supported by mdast."
author: "Mayank Chaudhari"
date: "2025-03-03"
categories: [Markdown, Syntax, Documentation]
tags: [mdast, markdown, reference]
---

# Markdown Syntax Showcase

## 9. Math Equations (KaTeX / LaTeX)

Displaying mathematical expressions.

Inline equation: $E=mc^2$

Block equation:

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$

### Inline Math

Inline math expressions can be enclosed within single dollar signs: $E=mc^2$. You can also use `\\(` and `\\)`: $\sum_{i=1}^{n} i^2$. With hat "$$\hat{x}$$".

### Display Math

Display math expressions are enclosed within double dollar signs, which renders them on their own line:

$$
\int_0^\infty x^2 e^{-x^2} dx = \frac{\sqrt{\pi}}{4}
$$

You can also use `\\[` and `\\]`:

$$
\frac{d}{dx} \left( \frac{1}{x} \right) = -\frac{1}{x^2}
$$

### Common Math Symbols

Here are some common mathematical symbols:

- Greek letters: $\alpha$, $\beta$, $\gamma$, $\Gamma$, $\Delta$, $\pi$, $\Pi$, $\Sigma$, $\omega$, $\Omega$
- Superscripts and subscripts: $x^2$, $y_i$, $a^{b+c}$, $e^{-i\omega t}$
- Fractions: $\frac{1}{2}$, $\frac{x+y}{z}$
- Square roots: $\sqrt{x}$, $\sqrt[3]{y}$
- Summations and products: $\sum_{i=1}^n i$, $\prod_{j=1}^m j$
- Integrals: $\int_a^b f(x) dx$, $\oint_C \vec{F} \cdot d\vec{r}$
- Limits: $\lim_{x \to \infty} \frac{1}{x}$
- Vectors: $\vec{v}$, $\mathbf{v}$
- Matrices: $\begin{pmatrix} a & b \\ c & d \end{pmatrix}$
- Partial derivatives: $\frac{\partial f}{\partial x}$
- Infinity: $\infty$
- Logical symbols: $\forall$, $\exists$, $\in$, $\notin$, $\subseteq$, $\supseteq$, $\land$, $\lor$, $\neg$
- Trigonometric functions: $\sin(x)$, $\cos(y)$, $\tan(z)$
- Exponential and logarithmic functions: $e^x$, $\ln(y)$, $\log_{10}(z)$

### Matrices

Matrices can be created using the `pmatrix`, `bmatrix`, `vmatrix`, and `Vmatrix` environments:

$$
\begin{pmatrix}
1 & 2 & 3 \\
4 & 5 & 6 \\
7 & 8 & 9
\end{pmatrix}
$$

$$
\begin{bmatrix}
1 & 2 \\
3 & 4
\end{bmatrix}
$$

$$
\begin{vmatrix}
a & b \\
c & d
\end{vmatrix}
$$

$$
\begin{Vmatrix}
a & b \\
c & d
\end{Vmatrix}
$$

### Alignments

You can align equations using the `align` environment:

$$
\begin{align}
y &= mx + b \\
y' &= m
\end{align}
$$

You can also use `aligned` for aligning parts of an equation:

$$
f(x) = \begin{cases}
x^2, & \text{if } x \ge 0 \\
-x^2, & \text{otherwise}
\end{cases}
$$

$$
\begin{aligned}
(a+b)^2 &= (a+b)(a+b) \\
&= a^2 + ab + ba + b^2 \\
&= a^2 + 2ab + b^2
\end{aligned}
$$

### Case Statements

Case statements can be created using the `cases` environment:

$$
f(x) =
\begin{cases}
1, & \text{if } x > 0 \\
0, & \text{if } x = 0 \\
-1, & \text{if } x < 0
\end{cases}
$$

### Text in Math

You can include text within math expressions using the `\text{}` command:

$$
\text{Let } x \text{ be a real number.}
$$

### Colored Math

You can color math expressions using the `\textcolor{color}{math}` command:

$$
\textcolor{red}{E=mc^2}
$$

$$
\textcolor{blue}{\sum_{i=1}^n i}
$$

### Math Macros

You can define custom macros:

```latex
\newcommand{\norm}[1]{\left\lVert#1\right\rVert}
```
