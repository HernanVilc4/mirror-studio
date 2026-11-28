package com.mirrorstudio.app.presentation

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.mirrorstudio.app.presentation.motion.Motion
import com.mirrorstudio.app.presentation.motion.reducedMotion

/** Pila de pantallas sencilla. [forward] decide hacia que lado se desliza la transicion. */
@Stable
class Navigator<T : Any>(start: T) {
    val stack = mutableStateListOf(start)
    var forward by mutableStateOf(true)
        private set
    val top: T get() = stack.last()
    val canPop: Boolean get() = stack.size > 1

    fun push(d: T) { forward = true; stack.add(d) }
    fun replace(d: T) { forward = true; stack[stack.lastIndex] = d }
    fun pop(): Boolean { if (!canPop) return false; forward = false; stack.removeAt(stack.lastIndex); return true }
    fun reset(d: T) { forward = false; stack.clear(); stack.add(d) }
}

/**
 * Cambio de pantalla del prototipo: la nueva entra 24 dp desde la derecha con fundido (250 ms, ease-out);
 * al volver, al reves. Con menos movimiento, solo fundido de 120 ms.
 */
@Composable
fun <S> ScreenTransition(
    target: S,
    forward: Boolean,
    modifier: Modifier = Modifier,
    key: (S) -> Any? = { it },
    content: @Composable (S) -> Unit
) {
    val reduced = reducedMotion()
    val shift = with(LocalDensity.current) { 24.dp.roundToPx() }
    AnimatedContent(
        targetState = target,
        modifier = modifier,
        contentKey = key,
        transitionSpec = { screenSpec(forward, reduced, shift) },
        label = "pantalla"
    ) { content(it) }
}

private fun <S> AnimatedContentTransitionScope<S>.screenSpec(forward: Boolean, reduced: Boolean, shift: Int): ContentTransform {
    if (reduced) return fadeIn(tween(Motion.REDUCED)) togetherWith fadeOut(tween(Motion.REDUCED))
    val spec = tween<androidx.compose.ui.unit.IntOffset>(Motion.SCREEN, easing = Motion.Ease)
    val dir = if (forward) 1 else -1
    return (slideInHorizontally(spec) { shift * dir } + fadeIn(tween(Motion.SCREEN, easing = Motion.Ease))) togetherWith
        (slideOutHorizontally(spec) { -shift * dir } + fadeOut(tween(Motion.SCREEN / 2)))
}
